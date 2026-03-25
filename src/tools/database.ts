import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.js";
import { checkTableAccess, checkWriteOperation, validateReadOnlySQL } from "../lib/safety.js";
import { withLogging } from "../lib/logger.js";

export function registerDatabaseTools(server: McpServer): void {
  server.tool(
    "list_tables",
    "List all tables in the database with their column counts and row count estimates",
    {},
    async () => {
      return withLogging("list_tables", {}, async () => {
        const client = getClient();

        const { data, error } = await client.rpc("pg_catalog_query", {
          query_text: `
            SELECT
              t.table_schema as schema,
              t.table_name as name,
              COUNT(c.column_name)::int as column_count,
              COALESCE(s.n_live_tup, 0)::int as estimated_row_count
            FROM information_schema.tables t
            LEFT JOIN information_schema.columns c
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            LEFT JOIN pg_stat_user_tables s
              ON t.table_name = s.relname AND t.table_schema = s.schemaname
            WHERE t.table_schema = 'public'
              AND t.table_type = 'BASE TABLE'
            GROUP BY t.table_schema, t.table_name, s.n_live_tup
            ORDER BY t.table_name
          `,
        }).maybeSingle();

        // Fallback: if the RPC doesn't exist, use direct query via information_schema
        if (error) {
          const { data: tables, error: tablesError } = await client
            .from("information_schema.tables" as string)
            .select("table_schema, table_name")
            .eq("table_schema", "public")
            .eq("table_type", "BASE TABLE");

          // If that also fails, try a simpler approach
          if (tablesError) {
            // Use a raw SQL approach via the built-in query endpoint
            const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
              headers: {
                apikey: process.env.SUPABASE_SERVICE_KEY as string,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              },
            });

            if (!response.ok) {
              throw new Error(`Failed to list tables: ${response.statusText}`);
            }

            const openApiSpec = (await response.json()) as {
              definitions?: Record<string, { properties?: Record<string, unknown> }>;
            };

            const tableList = Object.entries(openApiSpec.definitions ?? {}).map(
              ([name, def]) => ({
                schema: "public",
                name,
                column_count: Object.keys(def.properties ?? {}).length,
                estimated_row_count: -1,
              })
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(tableList, null, 2),
                },
              ],
            };
          }

          const tableList = (tables ?? []).map(
            (t: Record<string, string>) => ({
              schema: t.table_schema,
              name: t.table_name,
              column_count: 0,
              estimated_row_count: -1,
            })
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(tableList, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "describe_table",
    "Get the full schema of a table including columns, types, constraints, and foreign keys",
    {
      table: z.string().describe("The name of the table to describe"),
    },
    async ({ table }) => {
      return withLogging("describe_table", { table }, async () => {
        checkTableAccess(table);
        const client = getClient();

        // Fetch columns
        const { data: columns, error: colError } = await client
          .from("information_schema.columns" as string)
          .select("column_name, data_type, is_nullable, column_default")
          .eq("table_schema", "public")
          .eq("table_name", table)
          .order("ordinal_position");

        if (colError) {
          // Fallback: use the OpenAPI spec
          const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_KEY as string,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Failed to describe table: ${response.statusText}`);
          }

          const spec = (await response.json()) as {
            definitions?: Record<
              string,
              {
                properties?: Record<
                  string,
                  { type?: string; format?: string; description?: string }
                >;
                required?: string[];
              }
            >;
          };

          const tableDef = spec.definitions?.[table];
          if (!tableDef) {
            throw new Error(
              `Table "${table}" not found. Use list_tables to see available tables.`
            );
          }

          const required = new Set(tableDef.required ?? []);
          const cols = Object.entries(tableDef.properties ?? {}).map(
            ([name, prop]) => ({
              name,
              type: prop.format ?? prop.type ?? "unknown",
              nullable: !required.has(name),
              default: null,
              is_primary_key: prop.description?.includes("<pk/>") ?? false,
            })
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { name: table, columns: cols, foreign_keys: [], indexes: [] },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Fetch primary key columns
        const { data: pkData } = await client
          .from("information_schema.key_column_usage" as string)
          .select("column_name")
          .eq("table_schema", "public")
          .eq("table_name", table)
          .eq("constraint_name", `${table}_pkey`);

        const pkColumns = new Set(
          (pkData ?? []).map((r: Record<string, string>) => r.column_name)
        );

        const columnList = (columns ?? []).map(
          (col: Record<string, string>) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === "YES",
            default: col.column_default ?? null,
            is_primary_key: pkColumns.has(col.column_name),
          })
        );

        // Fetch foreign keys
        const { data: fkData } = await client.rpc("pg_catalog_query", {
          query_text: `
            SELECT
              kcu.column_name,
              ccu.table_name AS references_table,
              ccu.column_name AS references_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = '${table.replace(/'/g, "''")}'
          `,
        });

        const foreignKeys = Array.isArray(fkData)
          ? fkData.map((fk: Record<string, string>) => ({
              column: fk.column_name,
              references_table: fk.references_table,
              references_column: fk.references_column,
            }))
          : [];

        // Fetch indexes
        const { data: idxData } = await client.rpc("pg_catalog_query", {
          query_text: `
            SELECT
              i.relname AS name,
              array_agg(a.attname ORDER BY x.ordinality) AS columns,
              ix.indisunique AS is_unique
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
            WHERE n.nspname = 'public'
              AND t.relname = '${table.replace(/'/g, "''")}'
            GROUP BY i.relname, ix.indisunique
          `,
        });

        const indexes = Array.isArray(idxData)
          ? idxData.map((idx: Record<string, unknown>) => ({
              name: idx.name as string,
              columns: idx.columns as string[],
              is_unique: idx.is_unique as boolean,
            }))
          : [];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { name: table, columns: columnList, foreign_keys: foreignKeys, indexes },
                null,
                2
              ),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "select_rows",
    "Query rows from a table with optional filters, sorting, and pagination",
    {
      table: z.string().describe("The name of the table to query"),
      columns: z
        .array(z.string())
        .optional()
        .describe("Columns to select. Defaults to all columns."),
      filter: z
        .record(z.unknown())
        .optional()
        .describe("Key-value pairs to filter by (equality match)"),
      order_by: z.string().optional().describe("Column to order results by"),
      ascending: z
        .boolean()
        .optional()
        .default(true)
        .describe("Sort ascending (true) or descending (false)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(100)
        .describe("Maximum number of rows to return (1-1000, default 100)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of rows to skip for pagination"),
    },
    async ({ table, columns, filter, order_by, ascending, limit, offset }) => {
      return withLogging(
        "select_rows",
        { table, columns, filter, order_by, ascending, limit, offset },
        async () => {
          checkTableAccess(table);
          const client = getClient();

          const selectColumns = columns ? columns.join(", ") : "*";
          let query = client.from(table).select(selectColumns);

          if (filter) {
            for (const [key, value] of Object.entries(filter)) {
              query = query.eq(key, value as string);
            }
          }

          if (order_by) {
            query = query.order(order_by, { ascending: ascending ?? true });
          }

          query = query.range(offset ?? 0, (offset ?? 0) + (limit ?? 100) - 1);

          const { data, error } = await query;

          if (error) {
            throw new Error(`Query failed: ${error.message}`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        }
      );
    }
  );

  server.tool(
    "query",
    "Run a read-only SQL query against the database. Only SELECT statements are allowed.",
    {
      sql: z.string().describe("The SQL SELECT query to execute"),
    },
    async ({ sql }) => {
      return withLogging("query", { sql }, async () => {
        validateReadOnlySQL(sql);

        // Execute via the Supabase REST SQL endpoint
        const supabaseUrl = process.env.SUPABASE_URL as string;
        const serviceKey = process.env.SUPABASE_SERVICE_KEY as string;

        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({ query_text: sql }),
        });

        // If the RPC endpoint doesn't exist, try using the pg_meta SQL endpoint
        if (!response.ok) {
          // Try the SQL endpoint available in Supabase
          const sqlResponse = await fetch(`${supabaseUrl}/pg/sql`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ query: sql }),
          });

          if (!sqlResponse.ok) {
            // Final fallback: try the /rest/v1/rpc approach with a different function name
            const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ sql_query: sql }),
            });

            if (!rpcResponse.ok) {
              throw new Error(
                "Failed to execute SQL query. This feature requires a helper function in your database. " +
                  "See the README for setup instructions, or use select_rows for simpler queries."
              );
            }

            const rpcData: unknown = await rpcResponse.json();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(rpcData, null, 2),
                },
              ],
            };
          }

          const sqlData: unknown = await sqlResponse.json();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(sqlData, null, 2),
              },
            ],
          };
        }

        const data: unknown = await response.json();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "insert_row",
    "Insert a row into a table. Requires SUPABASE_READ_ONLY=false.",
    {
      table: z.string().describe("The name of the table to insert into"),
      data: z.record(z.unknown()).describe("The row data as key-value pairs"),
    },
    async ({ table, data }) => {
      return withLogging("insert_row", { table, data }, async () => {
        checkWriteOperation(table);
        const client = getClient();

        const { data: inserted, error } = await client
          .from(table)
          .insert(data as Record<string, string>)
          .select();

        if (error) {
          throw new Error(`Insert failed: ${error.message}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(inserted, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "update_rows",
    "Update rows matching a filter. Requires SUPABASE_READ_ONLY=false.",
    {
      table: z.string().describe("The name of the table to update"),
      data: z.record(z.unknown()).describe("The columns and values to update"),
      filter: z
        .record(z.unknown())
        .describe(
          "Filter to match rows to update (required — unfiltered updates are not allowed)"
        ),
    },
    async ({ table, data, filter }) => {
      return withLogging("update_rows", { table, data, filter }, async () => {
        if (!filter || Object.keys(filter).length === 0) {
          throw new Error(
            "A filter is required for update operations. " +
              "Unfiltered updates (updating all rows) are not allowed for safety."
          );
        }

        checkWriteOperation(table);
        const client = getClient();

        let query = client
          .from(table)
          .update(data as Record<string, string>);

        for (const [key, value] of Object.entries(filter)) {
          query = query.eq(key, value as string);
        }

        const { data: updated, error } = await query.select();

        if (error) {
          throw new Error(`Update failed: ${error.message}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      });
    }
  );
}
