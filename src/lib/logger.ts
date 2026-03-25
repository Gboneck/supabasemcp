interface LogEntry {
  timestamp: string;
  tool: string;
  params: Record<string, unknown>;
  success: boolean;
  duration_ms: number;
  error?: string;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "key",
  "authorization",
]);

function redactSensitive(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function logToolCall(entry: LogEntry): void {
  const logLine = {
    ...entry,
    params: redactSensitive(entry.params),
  };
  console.error(JSON.stringify(logLine));
}

export async function withLogging<T>(
  toolName: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logToolCall({
      timestamp: new Date().toISOString(),
      tool: toolName,
      params,
      success: true,
      duration_ms: Date.now() - start,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logToolCall({
      timestamp: new Date().toISOString(),
      tool: toolName,
      params,
      success: false,
      duration_ms: Date.now() - start,
      error: message,
    });
    throw error;
  }
}
