# supabase-mcp

Give Claude access to your Supabase project.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green.svg)](https://modelcontextprotocol.io)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) query your database, inspect schemas, manage auth users, and browse storage — all with safety guardrails built in.

## Quick Start

### 1. Install

```bash
npx supabase-mcp
```

Or install globally:

```bash
npm install -g supabase-mcp
```

### 2. Configure Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "supabase-mcp"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_KEY": "your-service-role-key"
      }
    }
  }
}
```

### 3. Use

Ask Claude things like:

- "Show me all tables in my database"
- "Describe the users table"
- "How many orders were placed this week?"
- "List all files in the avatars bucket"

## Available Tools

| Tool | Description | Write Mode Required |
|------|-------------|:-------------------:|
| `list_tables` | List all tables with column counts and row estimates | No |
| `describe_table` | Get full schema: columns, types, constraints, foreign keys | No |
| `select_rows` | Query rows with filters, sorting, and pagination | No |
| `query` | Run a read-only SQL SELECT query | No |
| `insert_row` | Insert a row into a table | Yes |
| `update_rows` | Update rows matching a filter | Yes |
| `list_users` | List auth users with pagination | No |
| `get_user` | Get a specific user by ID | No |
| `create_user` | Create a new auth user | Yes |
| `list_buckets` | List all storage buckets | No |
| `list_files` | List files in a storage bucket | No |
| `get_file_url` | Get a public or signed URL for a file | No |
| `get_project_info` | Get server configuration and connection info | No |

## Safety & Security

This server is designed to be safe for production use. Security is not an afterthought — it's the foundation.

### Read-Only by Default

The server starts in **read-only mode**. All write operations (`insert_row`, `update_rows`, `create_user`) are blocked unless you explicitly set `SUPABASE_READ_ONLY=false`. This means you can safely connect Claude to your production database for exploratory queries without risk of accidental writes.

### Table Access Control

Restrict which tables Claude can access using allowlists and blocklists:

- **Allowlist**: If `SUPABASE_ALLOWED_TABLES` is set, *only* those tables are accessible. Everything else is blocked.
- **Blocklist**: `SUPABASE_BLOCKED_TABLES` blocks specific tables. Applied after the allowlist.

Error messages for blocked tables do not reveal the full blocklist to prevent information leakage.

### SQL Safety

The `query` tool only accepts `SELECT` statements and `WITH` (CTE) queries. It rejects `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, and any other non-read statements. Multiple statements separated by semicolons are also rejected.

### Rate Limiting

Write operations are rate-limited to prevent runaway mutations. The default limit is **10 writes per minute**, configurable via `SUPABASE_WRITE_RATE_LIMIT`. When the limit is exceeded, the server returns a clear error with retry timing.

### Structured Logging

Every tool invocation is logged to stderr with timestamp, tool name, parameters (sensitive values redacted), success/failure status, and duration. Logs never go to stdout (which is reserved for MCP protocol messages).

## Configuration Reference

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `SUPABASE_URL` | Yes | — | Your Supabase project URL (e.g. `https://abc123.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Yes | — | Service role key (found in Dashboard > Settings > API) |
| `SUPABASE_READ_ONLY` | No | `true` | Set to `false` to enable write operations |
| `SUPABASE_ALLOWED_TABLES` | No | — | Comma-separated list of allowed tables. If set, only these tables are accessible. |
| `SUPABASE_BLOCKED_TABLES` | No | — | Comma-separated list of blocked tables. Applied after allowlist. |
| `SUPABASE_WRITE_RATE_LIMIT` | No | `10` | Maximum write operations per minute |

## Examples

### Explore your schema

> "Show me all tables and describe the users table"

Claude will call `list_tables` to see all tables, then `describe_table` for the users table to show columns, types, constraints, and foreign keys.

### Analyze data

> "How many orders were placed this week? Show me the trend by day."

Claude will use `select_rows` or `query` to count orders grouped by date, then present the results.

### Work with storage

> "List all files in the avatars bucket and get a signed URL for the first one"

Claude will call `list_files` with the avatars bucket, then `get_file_url` to generate a signed URL for accessing a private file.

## Architecture

```
┌──────────────┐     stdio      ┌──────────────────┐     HTTPS     ┌──────────────┐
│              │ ◄────────────► │                  │ ◄────────────► │              │
│  MCP Client  │   MCP JSON     │  supabase-mcp    │   REST API     │   Supabase   │
│  (Claude)    │   protocol     │  server          │   + Auth       │   Project    │
│              │                │                  │                │              │
└──────────────┘                └──────────────────┘                └──────────────┘
                                  │ Safety layer:
                                  │ • Read-only default
                                  │ • Table access control
                                  │ • SQL validation
                                  │ • Rate limiting
                                  │ • Structured logging
```

## Development

```bash
# Clone the repo
git clone https://github.com/gboneck/supabasemcp.git
cd supabasemcp

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_KEY=your-key \
npm run dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

### Optional: SQL query support

The `query` tool works best when you create a helper function in your Supabase database. Run this SQL in your Supabase SQL Editor:

```sql
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  EXECUTE sql_query INTO result;
  RETURN result;
END;
$$;
```

> **Note:** This function runs with elevated privileges. Only create it if you trust the MCP server's SQL validation layer, or add your own `pg_read_only` role restrictions.

## License

MIT — see [LICENSE](LICENSE).
