import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { JobStore } from "./jobs.js";
import { log } from "./log.js";
import { registerTools } from "./tools.js";

async function startBridge(port: number, token: string): Promise<{ bridge: Bridge; port: number }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = port + attempt;
    const bridge = new Bridge(candidate, token);
    try {
      await bridge.start();
      return { bridge, port: candidate };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw error;
      log.warn(`port ${candidate} in use, trying next`);
    }
  }
  throw new Error(`Could not bind a bridge port in range ${port}-${port + 9}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { bridge, port } = await startBridge(config.port, config.token);

  try {
    fs.mkdirSync(config.homeDir, { recursive: true });
    fs.writeFileSync(path.join(config.homeDir, "port"), `${port}\n`, "utf8");
  } catch {
    // non-fatal
  }

  const jobs = new JobStore(config.jobsFile, bridge);
  jobs.start();

  const server = new McpServer({ name: "flow-mcp", version: "0.1.0" });
  registerTools(server, bridge, jobs, config);

  bridge.on("connected", () => log.info("bridge ready"));
  bridge.on("event", (event: string, data: unknown) => log.debug("extension event", { event, data }));

  await server.connect(new StdioServerTransport());
  log.info("MCP server ready (stdio)", { port, homeDir: config.homeDir });

  if (config.token) {
    log.info(
      `pairing token: ${config.token.slice(0, 8)}… (full token in ${path.join(config.homeDir, "token")})`
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`shutting down (${signal})`);
    jobs.stop();
    await bridge.stop().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.stdin.on("close", () => void shutdown("stdin-close"));
}

main().catch((error) => {
  log.error("fatal", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
