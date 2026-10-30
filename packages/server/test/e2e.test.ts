import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "dist", "index.js");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readToken(home: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const token = fs.readFileSync(path.join(home, "token"), "utf8").trim();
      if (token.length > 20) return token;
    } catch {
      // not written yet
    }
    await delay(50);
  }
  throw new Error("token file was not created");
}

interface FakeExtensionOptions {
  token: string;
  port: number;
  downloadFile: string;
}

function startFakeExtension(options: FakeExtensionOptions): {
  socket: WebSocket;
  close: () => void;
  calls: string[];
} {
  const calls: string[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}/ws`, {
    origin: "chrome-extension://testextensionid"
  });
  let pollCount = 0;

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        v: 1,
        type: "hello",
        token: options.token,
        extensionVersion: "0.1.0-test",
        extensionId: "testextensionid"
      })
    );
  });

  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as { type?: string; id?: string; method?: string; params?: unknown };
    if (message.type === "welcome") return;
    if (typeof message.method !== "string" || typeof message.id !== "string") return;
    calls.push(message.method);

    const respond = (result: unknown) =>
      socket.send(JSON.stringify({ v: 1, id: message.id, ok: true, result }));

    switch (message.method) {
      case "status":
        respond({
          connected: true,
          protocolVersion: 1,
          extensionVersion: "0.1.0-test",
          tabId: 7,
          url: "https://flow.google.com/u/1/project/p1",
          accountIndex: 1,
          email: "test@example.com",
          projectId: "p1",
          pageReady: true,
          hooksInstalled: true,
          capabilities: {
            apiReplay: false,
            domSubmit: true,
            recaptchaMint: false,
            trustedClicks: false,
            hooksInstalled: true
          },
          downloadDir: null,
          downloadSubdir: "Flow"
        });
        break;
      case "accounts.list":
        respond({
          accounts: [
            {
              index: 1,
              email: "test@example.com",
              displayName: null,
              signedIn: true,
              url: "https://flow.google.com/u/1/project/p1",
              tabId: 7,
              active: false
            }
          ],
          selectedIndex: 1
        });
        break;
      case "accounts.select":
        respond({ index: 1, email: "test@example.com", verified: true });
        break;
      case "projects.list":
        respond({
          projects: [
            {
              projectId: "p1",
              name: "MCP Test",
              url: "https://flow.google.com/u/1/project/p1",
              accountIndex: 1,
              updatedAt: null
            }
          ],
          accountIndex: 1,
          pageUrl: "https://flow.google.com/u/1/"
        });
        break;
      case "projects.create":
        respond({ projectId: "p2", url: "https://flow.google.com/u/1/project/p2", name: "MCP Test", accountIndex: 1 });
        break;
      case "projects.open":
        respond({ tabId: 7, url: "https://flow.google.com/u/1/project/p1", projectId: "p1", accountIndex: 1 });
        break;
      case "projects.media":
        respond({ projectId: "p1", items: [], pageUrl: "https://flow.google.com/u/1/project/p1", capturedAt: new Date().toISOString() });
        break;
      case "media.poll": {
        pollCount += 1;
        const items =
          pollCount > 1
            ? [
                {
                  mediaId: "media-1",
                  kind: "image",
                  url: "https://flow-content.google/media/media-1",
                  thumbUrl: null,
                  prompt: "a red fox",
                  model: "Nano Banana Pro",
                  createdAt: null,
                  projectId: "p1"
                }
              ]
            : [];
        respond({ projectId: "p1", items, pageUrl: "https://flow.google.com/u/1/project/p1", capturedAt: new Date().toISOString(), freshCount: items.length });
        break;
      }
      case "media.download":
        respond({
          mediaId: "media-1",
          path: options.downloadFile,
          filename: path.basename(options.downloadFile),
          bytes: 5,
          mime: "image/jpeg",
          downloadId: 1
        });
        break;
      case "models.list":
        respond({
          models: [{ name: "Nano Banana Pro", kind: "image", aspects: ["16:9"], credits: null }],
          aspects: ["1:1", "16:9"],
          accountIndex: 1
        });
        break;
      case "image.generate":
        respond({
          projectId: "p1",
          projectName: "MCP Test",
          accountIndex: 1,
          tabId: 7,
          strategy: "dom",
          submittedAt: new Date().toISOString(),
          baselineMediaIds: [],
          warnings: []
        });
        break;
      case "selftest":
        respond({
          ok: true,
          checks: [{ id: "hooks", ok: true, detail: "fake" }],
          captured: { generateTemplates: 0, apiHosts: [], recaptchaSiteKeys: [], lastGenerateAt: null }
        });
        break;
      case "discovery.export":
        respond({
          exportedAt: new Date().toISOString(),
          version: "0.1.0-test",
          accountIndex: 1,
          pageUrl: "https://flow.google.com/u/1/project/p1",
          projectId: "p1",
          apiHosts: [],
          recaptchaSiteKeys: [],
          templates: [],
          capturedResponses: []
        });
        break;
      case "config.get":
        respond({ settings: {} });
        break;
      default:
        socket.send(
          JSON.stringify({
            v: 1,
            id: message.id,
            ok: false,
            error: { code: "E_BAD_INPUT", message: `unhandled ${message.method}` }
          })
        );
    }
  });

  return { socket, close: () => socket.close(), calls };
}

test("MCP server drives a Flow session end to end over the websocket bridge", { timeout: 90_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-e2e-"));
  const port = await freePort();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-files-"));
  const downloadFile = path.join(workDir, "downloaded.jpg");
  fs.writeFileSync(downloadFile, "image");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, "--embed"],
    env: {
      ...process.env,
      MEDIA_MCP_HOME: home,
      MEDIA_MCP_PORT: String(port)
    },
    stderr: "pipe"
  });

  const client = new Client({ name: "media-mcp-test", version: "0.0.0" });
  await client.connect(transport);

  const token = await readToken(home);
  const fake = startFakeExtension({ token, port, downloadFile });

  try {
    let status: Awaited<ReturnType<typeof client.callTool>> | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await client.callTool({ name: "flow_status", arguments: {} });
      const text = (status.content as { type: string; text?: string }[])[0]?.text ?? "";
      if (text.includes('"connectionState": "connected"')) break;
      await delay(100);
    }

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of [
      "flow_status",
      "flow_accounts_list",
      "flow_project_create",
      "flow_image_generate",
      "flow_job_status",
      "flow_media_download",
      "flow_selftest"
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }

    const statusText = ((status!.content as { text: string }[])[0]!).text;
    const statusBody = JSON.parse(statusText) as {
      connectionState: string;
      extension: { accountIndex: number; email: string };
    };
    assert.equal(statusBody.connectionState, "connected");
    assert.equal(statusBody.extension.accountIndex, 1);
    assert.equal(statusBody.extension.email, "test@example.com");

    const accounts = await client.callTool({ name: "flow_accounts_list", arguments: {} });
    const accountsBody = JSON.parse((accounts.content as { text: string }[])[0]!.text) as {
      accounts: { index: number }[];
    };
    assert.equal(accountsBody.accounts[0]!.index, 1);

    const created = await client.callTool({
      name: "flow_image_generate",
      arguments: { prompt: "a red fox in the snow", projectId: "p1", count: 1 }
    });
    const createdBody = JSON.parse((created.content as { text: string }[])[0]!.text) as {
      jobId: string;
      status: string;
      projectId: string;
    };
    assert.equal(createdBody.projectId, "p1");
    assert.ok(createdBody.jobId);

    let jobBody: { status: string; mediaIds: string[] } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const job = await client.callTool({
        name: "flow_job_status",
        arguments: { jobId: createdBody.jobId }
      });
      jobBody = JSON.parse((job.content as { text: string }[])[0]!.text) as {
        status: string;
        mediaIds: string[];
      };
      if (jobBody.status === "completed") break;
      await delay(150);
    }
    assert.equal(jobBody!.status, "completed");
    assert.deepEqual(jobBody!.mediaIds, ["media-1"]);

    const destDir = path.join(workDir, "custom");
    const download = await client.callTool({
      name: "flow_media_download",
      arguments: { mediaId: "media-1", projectId: "p1", projectName: "MCP Test", destDir }
    });
    const downloadBody = JSON.parse((download.content as { text: string }[])[0]!.text) as {
      path: string;
      moved: boolean;
    };
    assert.equal(downloadBody.moved, true);
    assert.ok(fs.existsSync(downloadBody.path), "downloaded file should be moved to destDir");
    assert.equal(fs.readFileSync(downloadBody.path, "utf8"), "image");

    const selftest = await client.callTool({ name: "flow_selftest", arguments: {} });
    const selftestBody = JSON.parse((selftest.content as { text: string }[])[0]!.text) as {
      bridge: { connectionState: string } | { state: string };
    };
    assert.ok(selftestBody.bridge);

    assert.ok(fake.calls.includes("image.generate"));
    assert.ok(fake.calls.includes("media.download"));
  } finally {
    fake.close();
    await client.close().catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("websocket bridge rejects a wrong pairing token", { timeout: 30_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-auth-"));
  const port = await freePort();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, "--embed"],
    env: { ...process.env, MEDIA_MCP_HOME: home, MEDIA_MCP_PORT: String(port) },
    stderr: "pipe"
  });
  const client = new Client({ name: "media-mcp-auth-test", version: "0.0.0" });
  await client.connect(transport);
  await readToken(home);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "chrome-extension://evil" });
  const closeCode = await new Promise<number>((resolve, reject) => {
    socket.on("open", () => {
      socket.send(
        JSON.stringify({ v: 1, type: "hello", token: "wrong-token-value", extensionVersion: "x", extensionId: "evil" })
      );
    });
    socket.on("close", (code) => resolve(code));
    socket.on("error", reject);
    setTimeout(() => reject(new Error("socket was not rejected")), 8000);
  });

  assert.equal(closeCode, 1008);
  await client.close().catch(() => undefined);
  fs.rmSync(home, { recursive: true, force: true });
});

test("websocket bridge rejects non-extension origins", { timeout: 30_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-origin-"));
  const port = await freePort();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, "--embed"],
    env: { ...process.env, MEDIA_MCP_HOME: home, MEDIA_MCP_PORT: String(port) },
    stderr: "pipe"
  });
  const client = new Client({ name: "media-mcp-origin-test", version: "0.0.0" });
  await client.connect(transport);
  await readToken(home);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "https://evil.example" });
  const rejected = await new Promise<boolean>((resolve) => {
    socket.on("open", () => resolve(false));
    socket.on("error", () => resolve(true));
    socket.on("close", () => resolve(true));
    setTimeout(() => resolve(false), 5000);
  });

  assert.equal(rejected, true);
  await client.close().catch(() => undefined);
  fs.rmSync(home, { recursive: true, force: true });
});
