import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  sanitizeSegment,
  toRpcError,
  type DownloadResult,
  type GenerateAck,
  type StatusResult
} from "@media-mcp/shared";
import {
  accountsSelectParams,
  configSetParams,
  emptyParams,
  imageGenerateParams,
  mediaDownloadParams,
  modelsListParams,
  projectCreateParams,
  projectMediaParams,
  projectOpenParams,
  projectsListParams
} from "@media-mcp/shared/schemas";
import type { Bridge } from "./bridge.js";
import type { ServerConfig } from "./config.js";
import { readSettings, writeSettings } from "./config.js";
import type { JobStore } from "./jobs.js";
import { log } from "./log.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const rpc = toRpcError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: rpc }, null, 2) }] };
}

function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 1; index < 500; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

async function moveTo(absoluteSource: string, destDir: string): Promise<string> {
  await fs.promises.mkdir(destDir, { recursive: true });
  const target = uniquePath(path.join(destDir, path.basename(absoluteSource)));
  try {
    await fs.promises.rename(absoluteSource, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM") throw error;
    await fs.promises.copyFile(absoluteSource, target);
    await fs.promises.unlink(absoluteSource);
  }
  return target;
}

export function registerTools(
  server: McpServer,
  bridge: Bridge,
  jobs: JobStore,
  config: ServerConfig
): void {
  server.registerTool(
    "flow_status",
    {
      title: "Flow bridge status",
      description:
        "Report the MCP bridge state: extension connection, active Flow tab, detected Google account (from the /u/N/ URL path), project, page readiness and capabilities.",
      inputSchema: emptyParams.shape,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const bridgeStatus = bridge.status();
        if (!bridge.isConnected()) return ok({ ...bridgeStatus, extension: null });
        const extension = await bridge.call<StatusResult>("status", undefined, 15_000);
        return ok({ ...bridgeStatus, extension });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_accounts_list",
    {
      title: "List Google accounts seen in Flow tabs",
      description:
        "Enumerate Google accounts that have a live flow.google.com tab, keyed by the /u/{index}/ URL path. Use the index with flow_account_select.",
      inputSchema: emptyParams.shape,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        return ok(await bridge.call("accounts.list", undefined, 20_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_account_select",
    {
      title: "Pin a Google account",
      description:
        "Pin the account used for subsequent calls. Accepts a /u/{index} number or an email. The extension verifies the signed-in account before any generation.",
      inputSchema: accountsSelectParams.shape
    },
    async (args) => {
      try {
        return ok(await bridge.call("accounts.select", args, 20_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_models_list",
    {
      title: "List available image models",
      description:
        "Return the image models and aspect ratios the current account can actually use, read from the live Flow UI.",
      inputSchema: modelsListParams.shape,
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        return ok(await bridge.call("models.list", args, 30_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_projects_list",
    {
      title: "List Flow projects",
      description: "List projects visible to the pinned account, optionally filtered by account index.",
      inputSchema: projectsListParams.shape,
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        return ok(await bridge.call("projects.list", args, 45_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_project_create",
    {
      title: "Create a Flow project",
      description:
        "Create a new project in the pinned account and return its id and URL. Useful for isolating experiments from existing work.",
      inputSchema: projectCreateParams.shape
    },
    async (args) => {
      try {
        return ok(await bridge.call("projects.create", args, 60_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_project_open",
    {
      title: "Open a Flow project",
      description: "Open (or focus) a project tab for the pinned account and return the tab id.",
      inputSchema: projectOpenParams.shape
    },
    async (args) => {
      try {
        return ok(await bridge.call("projects.open", args, 45_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_media_list",
    {
      title: "List media in a project",
      description: "List images/videos currently rendered in a project, with media ids and download URLs.",
      inputSchema: projectMediaParams.shape,
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        return ok(await bridge.call("projects.media", args, 60_000));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_image_generate",
    {
      title: "Generate images in Flow",
      description:
        "Submit an image prompt to a Flow project and return a job id immediately. Poll with flow_job_status, then download with flow_media_download. Generation is queued single-flight to avoid rate limits. Images do not consume Flow credits, only the per-model daily limit.",
      inputSchema: imageGenerateParams.shape
    },
    async (args) => {
      try {
        if (args.referenceImages && args.referenceImages.length > 0) {
          return fail(
            Object.assign(new Error("referenceImages is not implemented yet; send a text-only prompt"), {
              code: "E_UNSUPPORTED"
            })
          );
        }
        const expectedCount = args.count ?? 1;
        const ack = await bridge.call<GenerateAck>(
          "image.generate",
          {
            prompt: args.prompt,
            projectId: args.projectId,
            projectName: args.projectName,
            accountIndex: args.accountIndex,
            model: args.model,
            aspectRatio: args.aspectRatio,
            count: expectedCount,
            strategy: args.strategy ?? "auto",
            timeoutMs: args.timeoutMs
          },
          180_000
        );

        const job = jobs.create({
          projectId: ack.projectId,
          projectName: ack.projectName,
          accountIndex: ack.accountIndex,
          prompt: args.prompt,
          expectedCount,
          strategy: ack.strategy,
          tabId: ack.tabId,
          baselineMediaIds: ack.baselineMediaIds
        });

        jobs.update(job.id, { submittedAt: ack.submittedAt });

        return ok({
          jobId: job.id,
          status: job.status,
          projectId: job.projectId,
          projectName: job.projectName,
          accountIndex: job.accountIndex,
          strategy: job.strategy,
          expectedCount,
          baselineMediaIds: ack.baselineMediaIds,
          warnings: ack.warnings,
          next: "Call flow_job_status with this jobId until status is completed."
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_job_status",
    {
      title: "Check a generation job",
      description: "Poll a generation job. Returns status, discovered media ids and download instructions.",
      inputSchema: { jobId: z.string().min(1).optional() },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        const input = args as { jobId?: string };
        if (!input.jobId) {
          return ok({ jobs: jobs.list(20) });
        }
        const job = jobs.get(input.jobId);
        if (!job) {
          return fail(Object.assign(new Error(`Unknown jobId: ${input.jobId}`), { code: "E_NOT_FOUND" }));
        }
        const updated = await jobs.poll(job);
        return ok({
          jobId: updated.id,
          status: updated.status,
          projectId: updated.projectId,
          projectName: updated.projectName,
          accountIndex: updated.accountIndex,
          prompt: updated.prompt,
          expectedCount: updated.expectedCount,
          mediaIds: updated.mediaIds,
          error: updated.error,
          submittedAt: updated.submittedAt,
          updatedAt: updated.updatedAt,
          hint:
            updated.status === "completed"
              ? "Call flow_media_download for each mediaId."
              : "Call flow_job_status again in a few seconds."
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_media_download",
    {
      title: "Download Flow media to disk",
      description:
        "Download a media item through Chrome and return the absolute path on disk. Files land in the browser Downloads folder under the configured subfolder unless destDir is provided; when destDir is given the MCP server moves the file there.",
      inputSchema: mediaDownloadParams.shape
    },
    async (args) => {
      try {
        const settings = readSettings(config);
        const subdir = args.subdir ?? settings.downloadSubdir;
        const result = await bridge.call<DownloadResult>(
          "media.download",
          {
            mediaId: args.mediaId,
            url: args.url,
            projectId: args.projectId,
            projectName: args.projectName,
            filename: args.filename,
            subdir
          },
          180_000
        );

        let finalPath = result.path;
        let moved = false;
        if (args.destDir) {
          finalPath = await moveTo(result.path, path.resolve(args.destDir));
          moved = true;
        }

        return ok({
          mediaId: result.mediaId,
          path: finalPath,
          filename: path.basename(finalPath),
          bytes: result.bytes,
          mime: result.mime,
          moved,
          downloadId: result.downloadId
        });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_selftest",
    {
      title: "Flow integration self-test",
      description:
        "Check whether the DOM selectors, capture hooks and API templates still work after a Flow UI update. Run this first when generation starts failing.",
      inputSchema: emptyParams.shape,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        if (!bridge.isConnected()) return ok({ ok: false, bridge: bridge.status(), extension: null });
        const result = await bridge.call("selftest", undefined, 60_000);
        return ok({ bridge: bridge.status(), extension: result });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_discovery_export",
    {
      title: "Export captured Flow requests",
      description:
        "Export the request templates, API hosts, reCAPTCHA site keys and recent responses observed on the live page. Used to calibrate API replay after a Flow update.",
      inputSchema: emptyParams.shape,
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const data = await bridge.call("discovery.export", undefined, 30_000);
        const target = path.join(config.homeDir, "discovery-capture.json");
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        log.info("discovery export written", { target });
        return ok({ path: target, data });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "flow_config",
    {
      title: "Read or update bridge settings",
      description:
        "Read current settings or update downloadSubdir, defaultAccountIndex and allowSpend. Passing no values returns the current settings.",
      inputSchema: configSetParams.shape
    },
    async (args) => {
      try {
        if (Object.keys(args).length === 0) {
          return ok({ settings: readSettings(config), homeDir: config.homeDir, allowSpend: config.allowSpend });
        }
        const updated = writeSettings(config, {
          ...(args.downloadSubdir !== undefined ? { downloadSubdir: sanitizeSegment(args.downloadSubdir, "Flow") } : {}),
          ...(args.defaultAccountIndex !== undefined ? { defaultAccountIndex: args.defaultAccountIndex } : {}),
          ...(args.allowSpend !== undefined ? { allowSpend: args.allowSpend } : {})
        });
        return ok({ settings: updated });
      } catch (error) {
        return fail(error);
      }
    }
  );
}
