#!/usr/bin/env node
/**
 * Live smoke test: drives a real, signed-in Chrome session through the MCP server.
 *
 * 1. Loads packages/extension/dist/extension as an unpacked extension in Chrome.
 * 2. Opens the extension popup and clicks "Pair with MCP server".
 * 3. Run: npm run smoke -- --project "MCP Test" --prompt "a red fox in snow"
 *
 * The script creates (or reuses) a dedicated project so real work is never touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const projectName = arg("project", "MCP Test");
const prompt = arg("prompt", "a cinematic photo of a red fox standing in fresh snow, soft morning light");
const waitSeconds = Number(arg("wait", "180"));
const outDir = path.resolve(arg("out", path.join(process.cwd(), "out")));
const home = process.env.MEDIA_MCP_HOME || path.join(os.homedir(), ".media-mcp");
const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "packages", "server", "dist", "index.js");
const port = Number(arg("port", process.env.MEDIA_MCP_PORT || "8765"));

if (!fs.existsSync(entry)) {
  console.error("Build the server first: npm run build");
  process.exit(1);
}

const log = (...parts) => console.error("[smoke]", ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return null;
  const first = content.find((item) => item.type === "text");
  if (!first?.text) return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env, MEDIA_MCP_HOME: home, MEDIA_MCP_PORT: String(port) },
  stderr: "inherit"
});

const client = new Client({ name: "flow-smoke", version: "0.1.0" });
await client.connect(transport);

async function call(name, params = {}) {
  const result = await client.callTool({ name, arguments: params });
  const payload = textOf(result);
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

try {
  log(`waiting for the Chrome extension on port ${port} (up to ${waitSeconds}s)…`);
  log('if it is not paired yet: open the extension popup and click "Pair with MCP server".');

  const deadline = Date.now() + waitSeconds * 1000;
  let status = null;
  let lastNotice = 0;
  while (Date.now() < deadline) {
    try {
      status = await call("flow_status");
    } catch (error) {
      status = null;
    }
    if (status?.connectionState === "connected") break;
    if (Date.now() - lastNotice > 10_000) {
      lastNotice = Date.now();
      log("still waiting…");
    }
    await sleep(2000);
  }

  if (status?.connectionState !== "connected") {
    throw new Error("The extension never connected. Check that it is loaded, paired, and Chrome is running.");
  }

  log(`connected: extension ${status.extensionVersion}, account /u/${status.extension.accountIndex ?? "0"}/ ${status.extension.email ?? ""}`);

  const accounts = await call("flow_accounts_list");
  log(`accounts: ${accounts.accounts.map((account) => `/u/${account.index}/ ${account.email ?? "unknown"}`).join(", ") || "none"}`);

  const projects = await call("flow_projects_list", { limit: 100 });
  let project = projects.projects.find(
    (candidate) => (candidate.name ?? "").trim().toLowerCase() === projectName.trim().toLowerCase()
  );
  if (project) {
    log(`reusing project "${projectName}" (${project.projectId})`);
  } else {
    log(`creating project "${projectName}"`);
    const created = await call("flow_project_create", { name: projectName });
    project = { projectId: created.projectId, name: created.name ?? projectName };
  }

  const models = await call("flow_models_list", { kind: "image" });
  log(`image models: ${models.models.map((model) => model.name).slice(0, 6).join(", ")}`);

  log("submitting image generation…");
  const job = await call("flow_image_generate", {
    prompt,
    projectId: project.projectId,
    projectName: project.name ?? projectName,
    count: 1
  });
  log(`job ${job.jobId} started via ${job.strategy}${job.warnings?.length ? ` (${job.warnings.join(" | ")})` : ""}`);

  let finalJob = job;
  const jobDeadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < jobDeadline) {
    await sleep(3000);
    finalJob = await call("flow_job_status", { jobId: job.jobId });
    log(`job status: ${finalJob.status}`);
    if (finalJob.status === "completed" || finalJob.status === "failed" || finalJob.status === "timeout") break;
  }

  if (finalJob.status !== "completed") {
    throw new Error(`job ended as ${finalJob.status}: ${JSON.stringify(finalJob.error)}`);
  }

  const downloaded = [];
  for (const mediaId of finalJob.mediaIds) {
    const file = await call("flow_media_download", {
      mediaId,
      projectId: project.projectId,
      projectName: project.name ?? projectName,
      destDir: outDir
    });
    downloaded.push(file);
    log(`saved ${file.path} (${file.bytes} bytes, ${file.mime})`);
  }

  const selftest = await call("flow_selftest");
  console.log(
    JSON.stringify(
      {
        ok: true,
        project,
        account: status.extension.accountIndex,
        job: { id: finalJob.jobId, status: finalJob.status, mediaIds: finalJob.mediaIds },
        downloaded,
        selftest
      },
      null,
      2
    )
  );
} catch (error) {
  console.error("[smoke] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
  await sleep(200);
}
