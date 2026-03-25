import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.js";
import { withLogging } from "../lib/logger.js";

export function registerStorageTools(server: McpServer): void {
  server.tool(
    "list_buckets",
    "List all storage buckets",
    {},
    async () => {
      return withLogging("list_buckets", {}, async () => {
        const client = getClient();

        const { data, error } = await client.storage.listBuckets();

        if (error) {
          throw new Error(`Failed to list buckets: ${error.message}`);
        }

        const buckets = (data ?? []).map((bucket) => ({
          id: bucket.id,
          name: bucket.name,
          public: bucket.public,
          created_at: bucket.created_at,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(buckets, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "list_files",
    "List files in a storage bucket",
    {
      bucket: z.string().describe("The name of the storage bucket"),
      path: z.string().optional().describe("Path prefix to list files in (e.g. 'avatars/')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(100)
        .describe("Maximum number of files to return (default 100)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of files to skip for pagination"),
    },
    async ({ bucket, path, limit, offset }) => {
      return withLogging("list_files", { bucket, path, limit, offset }, async () => {
        const client = getClient();

        const { data, error } = await client.storage
          .from(bucket)
          .list(path ?? "", {
            limit: limit ?? 100,
            offset: offset ?? 0,
          });

        if (error) {
          throw new Error(`Failed to list files: ${error.message}`);
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
    "get_file_url",
    "Get a URL for a file. Returns public URL for public buckets, signed URL for private.",
    {
      bucket: z.string().describe("The name of the storage bucket"),
      path: z.string().describe("The path to the file within the bucket"),
      expires_in: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(3600)
        .describe(
          "Expiration time in seconds for signed URLs (default 3600 = 1 hour)"
        ),
    },
    async ({ bucket, path, expires_in }) => {
      return withLogging("get_file_url", { bucket, path, expires_in }, async () => {
        const client = getClient();

        // Check if bucket is public
        const { data: buckets, error: bucketError } =
          await client.storage.listBuckets();

        if (bucketError) {
          throw new Error(`Failed to check bucket: ${bucketError.message}`);
        }

        const bucketInfo = (buckets ?? []).find((b) => b.name === bucket);

        if (!bucketInfo) {
          throw new Error(
            `Bucket "${bucket}" not found. Use list_buckets to see available buckets.`
          );
        }

        if (bucketInfo.public) {
          const { data } = client.storage.from(bucket).getPublicUrl(path);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { url: data.publicUrl, is_signed: false },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Private bucket — create signed URL
        const { data, error } = await client.storage
          .from(bucket)
          .createSignedUrl(path, expires_in ?? 3600);

        if (error) {
          throw new Error(`Failed to create signed URL: ${error.message}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { url: data.signedUrl, is_signed: true },
                null,
                2
              ),
            },
          ],
        };
      });
    }
  );
}
