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
      command: ["node", entry],
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
      { mcpServers: { flow: { command: "node", args: [entry] } } },
      null,
      2
    )
  );
}

console.log(
  "\nNext: run `npm run build`, load packages/extension/dist/extension as an unpacked extension, open the popup and click Pair."
);
