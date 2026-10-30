import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_PORT } from "@media-mcp/shared";
import crypto from "node:crypto";
import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { JobStore } from "./jobs.js";
import { log } from "./log.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    console.error("media-ui-mcp 0.2.2");
    return;
  }
  const config = loadConfig();
  const embedded = process.argv.includes("--embed");
  config.port = embedded ? config.port : DEFAULT_PORT;
  if (process.argv.includes("--stdio")) {
    const remote = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${config.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` } }
    });
    const local = new StdioServerTransport();
    remote.onmessage = (message) => { void local.send(message); };
    local.onmessage = (message) => {
      void remote.send(message).catch((error) => {
        log.error("Cannot reach daemon; run npx media-ui-mcp first", { message: String(error) });
        process.exitCode = 1;
        void local.close();
        void remote.close();
      });
    };
    local.onclose = () => { void remote.close(); };
    remote.onerror = (error) => log.error("MCP connection failed", { message: String(error) });
    await remote.start();
    await local.start();
    return;
  }
  const bridge = new Bridge(config.port, config.token);
  const jobs = new JobStore(config.jobsFile, bridge);
  const servers = new Set<McpServer>();
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const createServer = (): McpServer => {
    const server = new McpServer({ name: "media-ui-mcp", version: "0.2.2" });
    registerTools(server, bridge, jobs, config);
    servers.add(server);
    return server;
  };
  bridge.mcpHandler = async (req, res) => {
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? sessions.get(id) : undefined;
    if (!transport) {
      if (id || req.method !== "POST") {
        res.writeHead(id ? 404 : 400).end();
        return;
      }
      const server = createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sessionId) => { sessions.set(sessionId, transport!); },
        enableJsonResponse: true
      });
      transport.onclose = () => {
        if (transport?.sessionId) sessions.delete(transport.sessionId);
        servers.delete(server);
      };
      await server.connect(transport);
      res.on("finish", () => {
        if (!transport?.sessionId) {
          servers.delete(server);
          void server.close();
        }
      });
    }
    await transport.handleRequest(req, res);
  };
  try {
    await bridge.start();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    const health = await fetch(`http://127.0.0.1:${config.port}/health`, {
      signal: AbortSignal.timeout(2000)
    }).then((response) => response.json()).catch(() => null) as { service?: string } | null;
    if (health?.service !== "media-mcp") throw new Error(`Port ${config.port} is occupied by another application`);
    log.info(`media-mcp already running on port ${config.port}`);
    return;
  }
  jobs.start();
  if (embedded) await createServer().connect(new StdioServerTransport());
  log.info(`media-mcp ready at http://127.0.0.1:${config.port}/mcp`);
  const shutdown = async (): Promise<void> => {
    jobs.stop();
    await Promise.all([...servers].map((server) => server.close().catch(() => undefined)));
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  if (embedded) process.stdin.on("close", () => void shutdown());
}

main().catch((error) => {
  log.error("fatal", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
