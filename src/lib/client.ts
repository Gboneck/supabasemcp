import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../types.js";

let client: SupabaseClient | null = null;
let config: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL is required. Set it to your Supabase project URL (e.g. https://abc123.supabase.co)"
    );
  }

  if (!supabaseServiceKey) {
    throw new Error(
      "SUPABASE_SERVICE_KEY is required. Set it to your Supabase service role key. " +
        "You can find it in your Supabase dashboard under Settings > API."
    );
  }

  const readOnlyEnv = process.env.SUPABASE_READ_ONLY;
  const readOnly = readOnlyEnv !== "false";

  const allowedTablesEnv = process.env.SUPABASE_ALLOWED_TABLES;
  const allowedTables = allowedTablesEnv
    ? allowedTablesEnv.split(",").map((t) => t.trim()).filter(Boolean)
    : null;

  const blockedTablesEnv = process.env.SUPABASE_BLOCKED_TABLES;
  const blockedTables = blockedTablesEnv
    ? blockedTablesEnv.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const writeRateLimitEnv = process.env.SUPABASE_WRITE_RATE_LIMIT;
  const writeRateLimit = writeRateLimitEnv ? parseInt(writeRateLimitEnv, 10) : 10;

  if (isNaN(writeRateLimit) || writeRateLimit < 1) {
    throw new Error(
      "SUPABASE_WRITE_RATE_LIMIT must be a positive integer. Default is 10."
    );
  }

  config = {
    supabaseUrl,
    supabaseServiceKey,
    readOnly,
    allowedTables,
    blockedTables,
    writeRateLimit,
  };

  return config;
}

export function getConfig(): ServerConfig {
  if (!config) {
    throw new Error("Configuration not loaded. Call loadConfig() first.");
  }
  return config;
}

export function getClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const cfg = getConfig();

  client = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
