import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "../lib/client.js";
import { withLogging } from "../lib/logger.js";

export function registerProjectTools(server: McpServer): void {
  server.tool(
    "get_project_info",
    "Get basic information about the connected Supabase project and server configuration",
    {},
    async () => {
      return withLogging("get_project_info", {}, async () => {
        const config = getConfig();

        const info = {
          url: config.supabaseUrl,
          is_read_only: config.readOnly,
          allowed_tables: config.allowedTables,
          blocked_tables: config.blockedTables.length > 0 ? `${config.blockedTables.length} tables blocked` : "none",
          write_rate_limit: config.writeRateLimit,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      });
    }
  );
}
