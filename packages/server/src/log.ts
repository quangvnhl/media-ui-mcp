const PREFIX = "[media-mcp]";

function write(level: string, message: string, extra?: unknown): void {
  const suffix = extra === undefined ? "" : ` ${safeJson(extra)}`;
  process.stderr.write(`${PREFIX} ${level} ${message}${suffix}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (message: string, extra?: unknown) => write("info", message, extra),
  warn: (message: string, extra?: unknown) => write("warn", message, extra),
  error: (message: string, extra?: unknown) => write("error", message, extra),
  debug: (message: string, extra?: unknown) => {
    if (process.env.MEDIA_MCP_DEBUG === "1") write("debug", message, extra);
  }
};
