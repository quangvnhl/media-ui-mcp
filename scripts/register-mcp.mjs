#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "packages", "server", "dist", "index.js");
const home = path.join(os.homedir(), ".media-mcp");
const writeOpencode = process.argv.includes("--write-opencode");
const opencodePath = path.join(root, "opencode.json");

if (!fs.existsSync(entry)) {
  console.error(`Server bundle not found at ${entry}. Run: npm run build`);
  process.exit(1);
}

const mcp = {
  mcp: {
    flow: {
      type: "local",
      command: ["node", entry, "--stdio"],
      enabled: true,
      environment: {
        MEDIA_MCP_HOME: home
      }
    }
  }
};

if (writeOpencode) {
  let existing = {};
  if (fs.existsSync(opencodePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(opencodePath, "utf8"));
    } catch (error) {
      console.error(`Cannot parse ${opencodePath}: ${error.message}`);
      process.exit(1);
    }
  }
  const merged = {
    $schema: "https://opencode.ai/config.json",
    ...existing,
    mcp: {
      ...(existing.mcp ?? {}),
      ...mcp.mcp
    }
  };
  fs.writeFileSync(opencodePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`Wrote ${opencodePath}`);
  console.log("Restart opencode for the MCP server to load.");
} else {
  console.log("Add this to your opencode config (or run with --write-opencode):\n");
  console.log(JSON.stringify(mcp, null, 2));
  console.log("\nClaude Desktop (claude_desktop_config.json):\n");
  console.log(
    JSON.stringify(
      { mcpServers: { flow: { command: "node", args: [entry, "--stdio"] } } },
      null,
      2
    )
  );
}

console.log(
  "\nStart one daemon with `npx media-ui-mcp` (or `npm start` from this repo). Keep that console open. All agents and the extension use port 61899. Load packages/extension/dist/extension and click Pair."
);
console.log(JSON.stringify({ mcp: { flow: {
  type: "remote",
  url: "http://127.0.0.1:61899/mcp",
  headers: { Authorization: "Bearer {env:MEDIA_MCP_TOKEN}" },
  enabled: true
} } }, null, 2));
