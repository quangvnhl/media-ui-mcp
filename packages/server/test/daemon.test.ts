import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("one daemon shares HTTP and stdio sessions without alternate ports", { timeout: 30_000 }, async () => {
  const entry = path.resolve(import.meta.dirname, "../dist/index.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-daemon-"));
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, MEDIA_MCP_HOME: home, MEDIA_MCP_PORT: String(port) } as Record<string, string>;
  const daemon = spawn(process.execPath, [entry, "--embed"], { env, stdio: ["pipe", "ignore", "ignore"] });
  const clients: Client[] = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (daemon.exitCode !== null) throw new Error("Daemon exited before becoming ready");
      const health = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
      if (health?.service === "media-mcp") { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    const token = fs.readFileSync(path.join(home, "token"), "utf8").trim();
    assert.equal((await fetch(`${url}/mcp`, { method: "POST" })).status, 401);
    const duplicate = spawn(process.execPath, [entry, "--embed"], { env, stdio: "ignore" });
    assert.equal((await once(duplicate, "exit"))[0], 0);
    const http = new Client({ name: "http-test", version: "1" });
    clients.push(http);
    await http.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    }));
    const shim = new Client({ name: "stdio-test", version: "1" });
    clients.push(shim);
    await shim.connect(new StdioClientTransport({ command: process.execPath, args: [entry, "--stdio", "--embed"], env, stderr: "pipe" }));
    const [a, b] = await Promise.all([http.listTools(), shim.listTools()]);
    assert.ok(a.tools.length > 0);
    assert.deepEqual(a.tools.map((tool) => tool.name), b.tools.map((tool) => tool.name));
    const [first, second] = await Promise.all([
      http.callTool({ name: "flow_job_status", arguments: {} }),
      shim.callTool({ name: "flow_job_status", arguments: {} })
    ]);
    assert.deepEqual(first, second);
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    daemon.kill();
    if (daemon.exitCode === null) await once(daemon, "exit");
    fs.rmSync(home, { recursive: true, force: true });
  }
});
