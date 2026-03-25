#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/client.js";
import { registerDatabaseTools } from "./tools/database.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerProjectTools } from "./tools/project.js";

function main(): void {
  // Validate configuration before starting the server
  try {
    loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[supabase-mcp] Configuration error: ${message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: "supabase-mcp",
    version: "0.1.0",
  });

  // Register all tool groups
  registerDatabaseTools(server);
  registerAuthTools(server);
  registerStorageTools(server);
  registerProjectTools(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("[supabase-mcp] Server started successfully");
  }).catch((error: unknown) => {
    const message = error instanceof Error ? (error as Error).message : String(error);
    console.error(`[supabase-mcp] Failed to start server: ${message}`);
    process.exit(1);
  });
}

main();
