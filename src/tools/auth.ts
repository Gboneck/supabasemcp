import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.js";
import { checkWriteOperation } from "../lib/safety.js";
import { withLogging } from "../lib/logger.js";

export function registerAuthTools(server: McpServer): void {
  server.tool(
    "list_users",
    "List auth users with pagination",
    {
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe("Page number (starting from 1)"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe("Number of users per page (1-1000, default 50)"),
    },
    async ({ page, per_page }) => {
      return withLogging("list_users", { page, per_page }, async () => {
        const client = getClient();

        const { data, error } = await client.auth.admin.listUsers({
          page: page ?? 1,
          perPage: per_page ?? 50,
        });

        if (error) {
          throw new Error(`Failed to list users: ${error.message}`);
        }

        const users = data.users.map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          user_metadata: user.user_metadata,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(users, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "get_user",
    "Get a specific user by ID",
    {
      user_id: z.string().describe("The UUID of the user to retrieve"),
    },
    async ({ user_id }) => {
      return withLogging("get_user", { user_id }, async () => {
        const client = getClient();

        const { data, error } = await client.auth.admin.getUserById(user_id);

        if (error) {
          throw new Error(`Failed to get user: ${error.message}`);
        }

        const user = {
          id: data.user.id,
          email: data.user.email,
          created_at: data.user.created_at,
          last_sign_in_at: data.user.last_sign_in_at,
          user_metadata: data.user.user_metadata,
          app_metadata: data.user.app_metadata,
          email_confirmed_at: data.user.email_confirmed_at,
          phone: data.user.phone,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(user, null, 2),
            },
          ],
        };
      });
    }
  );

  server.tool(
    "create_user",
    "Create a new user. Requires SUPABASE_READ_ONLY=false.",
    {
      email: z.string().email().describe("Email address for the new user"),
      password: z
        .string()
        .min(8)
        .optional()
        .describe("Password (min 8 characters). If omitted, a confirmation email is sent."),
      user_metadata: z
        .record(z.unknown())
        .optional()
        .describe("Optional user metadata as key-value pairs"),
    },
    async ({ email, password, user_metadata }) => {
      return withLogging("create_user", { email }, async () => {
        checkWriteOperation();
        const client = getClient();

        const createParams: {
          email: string;
          password?: string;
          user_metadata?: Record<string, unknown>;
          email_confirm?: boolean;
        } = { email };

        if (password) {
          createParams.password = password;
          createParams.email_confirm = true;
        }

        if (user_metadata) {
          createParams.user_metadata = user_metadata;
        }

        const { data, error } = await client.auth.admin.createUser(createParams);

        if (error) {
          throw new Error(`Failed to create user: ${error.message}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: data.user.id,
                  email: data.user.email,
                  created_at: data.user.created_at,
                  user_metadata: data.user.user_metadata,
                },
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
