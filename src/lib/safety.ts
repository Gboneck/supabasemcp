import { getConfig } from "./client.js";

const writeTimestamps: number[] = [];

export function checkTableAccess(table: string): void {
  const config = getConfig();

  if (config.allowedTables !== null) {
    if (!config.allowedTables.includes(table)) {
      throw new Error(
        `Access denied: table "${table}" is not in the allowed tables list. ` +
          `Allowed tables: ${config.allowedTables.join(", ")}. ` +
          `Configure SUPABASE_ALLOWED_TABLES to change this.`
      );
    }
  }

  if (config.blockedTables.includes(table)) {
    throw new Error(
      `Access denied: table "${table}" is not accessible. ` +
        `Contact your administrator if you believe this is an error.`
    );
  }
}

export function checkWriteEnabled(): void {
  const config = getConfig();

  if (config.readOnly) {
    throw new Error(
      "Write operations are disabled. The server is running in read-only mode (default). " +
        "To enable writes, set the SUPABASE_READ_ONLY environment variable to \"false\"."
    );
  }
}

export function checkRateLimit(): void {
  const config = getConfig();
  const now = Date.now();
  const windowStart = now - 60_000;

  // Remove timestamps outside the 1-minute window
  while (writeTimestamps.length > 0 && writeTimestamps[0] < windowStart) {
    writeTimestamps.shift();
  }

  if (writeTimestamps.length >= config.writeRateLimit) {
    const oldestInWindow = writeTimestamps[0];
    const retryAfterMs = oldestInWindow + 60_000 - now;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    throw new Error(
      `Rate limit exceeded: maximum ${config.writeRateLimit} write operations per minute. ` +
        `Try again in ${retryAfterSec} seconds. ` +
        `Configure SUPABASE_WRITE_RATE_LIMIT to change this limit.`
    );
  }

  writeTimestamps.push(now);
}

export function checkWriteOperation(table?: string): void {
  checkWriteEnabled();
  if (table) {
    checkTableAccess(table);
  }
  checkRateLimit();
}

const FORBIDDEN_SQL_PATTERNS = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i;

export function validateReadOnlySQL(sql: string): void {
  const trimmed = sql.trim();

  if (!trimmed) {
    throw new Error("SQL query cannot be empty.");
  }

  if (FORBIDDEN_SQL_PATTERNS.test(trimmed)) {
    throw new Error(
      "Only SELECT statements are allowed. " +
        "The query tool is read-only and does not permit data modification or DDL statements."
    );
  }

  if (!/^\s*SELECT\b/i.test(trimmed) && !/^\s*WITH\b/i.test(trimmed)) {
    throw new Error(
      "Only SELECT statements (including CTEs starting with WITH) are allowed. " +
        "The query tool is read-only."
    );
  }

  // Check for multiple statements (semicolon-separated)
  // Remove string literals and comments before checking
  const withoutStrings = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  const withoutComments = withoutStrings
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const statements = withoutComments.split(";").filter((s) => s.trim().length > 0);
  if (statements.length > 1) {
    throw new Error(
      "Only a single SQL statement is allowed. Multiple statements separated by semicolons are not permitted."
    );
  }
}
