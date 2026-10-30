import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("project registration writes portable paths and preserves unrelated MCP settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-mcp-registration-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "packages/server/dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/server/dist/index.js"), "");
    const script = path.join(root, "scripts/register-mcp.mjs");
    fs.copyFileSync(path.resolve(import.meta.dirname, "../../../scripts/register-mcp.mjs"), script);
    const configPath = path.join(root, "opencode.json");
    const other = { type: "local", command: ["example-command"], enabled: false };
    fs.writeFileSync(configPath, JSON.stringify({ mcp: { other }, model: "example/model" }));

    execFileSync(process.execPath, [script, "--write-opencode"], { cwd: root, stdio: "pipe" });

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    assert.deepEqual(config.mcp.flow.command, ["node", "./packages/server/dist/index.js", "--stdio"]);
    assert.equal(config.mcp.flow.environment, undefined);
    assert.deepEqual(config.mcp.other, other);
    assert.equal(config.model, "example/model");
    assert.equal(config.$schema, "https://opencode.ai/config.json");
    assert.equal(raw.includes(root.replaceAll("\\", "\\\\")), false);
    assert.equal(raw.includes(os.homedir().replaceAll("\\", "\\\\")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
