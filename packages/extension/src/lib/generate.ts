import {
  buildProjectUrl,
  DEFAULT_ASPECTS,
  DEFAULT_DOWNLOAD_SUBDIR,
  DEFAULT_IMAGE_MODELS,
  parseAccountIndex,
  parseProjectId,
  type MediaItem,
  type ModelOption
} from "@media-mcp/shared";
import { resolveAccountIndex } from "./accounts.js";
import { findOrCreateProject } from "./projects.js";
import { getSettings, type ReplayPlan } from "./storage.js";
import {
  callContent,
  ensureProjectPage,
  getTab,
  sleep,
  waitForPageReady
} from "./tabs.js";

export interface GenerateAck {
  projectId: string;
  projectName: string | null;
  accountIndex: number | null;
  tabId: number;
  strategy: "api" | "dom";
  submittedAt: string;
  baselineMediaIds: string[];
  warnings: string[];
}

export interface GenerateParams {
  prompt: string;
  projectId?: string;
  projectName?: string;
  accountIndex?: number | null;
  model?: string;
  aspectRatio?: string;
  count?: number;
  strategy?: "auto" | "api" | "dom";
  timeoutMs?: number;
}

interface PageSubmitResult {
  strategy: "api" | "dom";
  submittedAt: string;
  baselineMediaIds: string[];
  warnings: string[];
  needsTrustedClick: boolean;
  rect?: { x: number; y: number };
  projectName: string | null;
}

const DEFAULT_TEST_PROJECT = "MCP Test";

export async function generateImages(params: GenerateParams): Promise<GenerateAck> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);

  let projectId = params.projectId ?? null;
  let projectName = params.projectName ?? null;

  if (!projectId) {
    const desired = params.projectName ?? DEFAULT_TEST_PROJECT;
    const found = await findOrCreateProject(accountIndex, desired);
    projectId = found.projectId;
    projectName = found.name ?? desired;
  }

  const { tabId } = await ensureProjectPage(accountIndex, projectId);
  await waitForPageReady(tabId, params.timeoutMs ?? 60_000);

  const page = await callContent<{ items: MediaItem[]; pageUrl: string; projectId: string | null }>(
    tabId,
    "media",
    undefined,
    45_000
  );
  const baselineMediaIds = page.items.map((item) => item.mediaId);

  const settings = await getSettings();
  const plan = settings.replayPlan ?? undefined;
  const strategy = params.strategy ?? "auto";

  let result: PageSubmitResult;
  const trustedWarnings =
    strategy === "api" ? null : await trustedSubmit(tabId, params.prompt, params.count ?? 1);

  if (trustedWarnings) {
    const info = await callContent<{ projectName: string | null }>(tabId, "info", undefined, 15_000).catch(
      () => null
    );
    result = {
      strategy: "dom",
      submittedAt: new Date().toISOString(),
      baselineMediaIds,
      warnings: trustedWarnings,
      needsTrustedClick: false,
      projectName: info?.projectName ?? projectName
    };
  } else {
    result = await callContent<PageSubmitResult>(
      tabId,
      "submit",
      {
        prompt: params.prompt,
        count: params.count ?? 1,
        model: params.model,
        aspectRatio: params.aspectRatio,
        strategy,
        plan
      },
      Math.min(params.timeoutMs ?? 120_000, 180_000)
    );
  }

  const warnings = [...result.warnings];

  if (result.needsTrustedClick && result.rect) {
    const before = await callContent<{ rpc: number; templates: number }>(
      tabId,
      "capture-stats",
      undefined,
      10_000
    ).catch(() => ({ rpc: 0, templates: 0 }));
    const clicked = await trustedClickIfAvailable(tabId, result.rect.x, result.rect.y);
    if (clicked) {
      await sleep(2500);
      const after = await callContent<{ rpc: number; templates: number }>(
        tabId,
        "capture-stats",
        undefined,
        10_000
      ).catch(() => ({ rpc: before.rpc, templates: before.templates }));
      const fired = after.rpc > before.rpc || after.templates > before.templates;
      warnings.push(
        fired
          ? "Sent a trusted click through the Chrome debugger API; a generation request was observed on the wire"
          : "Sent a trusted click through the Chrome debugger API, but no generation request was observed yet"
      );
    } else {
      warnings.push(
        "The generate button ignored both the synthetic and the trusted click; click Generate manually once"
      );
    }
  }

  const tab = await getTab(tabId);
  const pageUrl = tab?.url ?? "";
  const liveAccountIndex = parseAccountIndex(pageUrl);
  if (liveAccountIndex !== accountIndex && projectId) {
    // Flow may normalize /u/0/ to the bare path for the default account.
    const liveProject = parseProjectId(pageUrl);
    if (liveAccountIndex === null && accountIndex !== 0 && liveProject === projectId) {
      warnings.push(`Page URL has no /u/N/ segment while pinned to account ${accountIndex}`);
    }
  }

  return {
    projectId,
    projectName: result.projectName ?? projectName,
    accountIndex,
    tabId,
    strategy: result.strategy,
    submittedAt: result.submittedAt,
    baselineMediaIds: result.baselineMediaIds.length > 0 ? result.baselineMediaIds : baselineMediaIds,
    warnings
  };
}

async function trustedSubmit(
  tabId: number,
  prompt: string,
  count: number
): Promise<string[] | null> {
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ permissions: ["debugger"] });
  } catch {
    return null;
  }
  if (!granted) return null;

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) return null;
  }

  try {
    await callContent(tabId, "focus-prompt", undefined, 15_000);
    await sleep(300);
    await chrome.debugger.sendCommand(target, "Input.insertText", { text: prompt });
    await sleep(600);

    const presses = Math.max(1, Math.min(4, count));
    for (let index = 0; index < presses; index += 1) {
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "char",
        text: "\r",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
      await sleep(1500);
    }
    return ["Submitted with trusted CDP input (debugger permission)"];
  } catch (error) {
    return null;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function trustedClickIfAvailable(tabId: number, x: number, y: number): Promise<boolean> {
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ permissions: ["debugger"] });
  } catch {
    return false;
  }
  if (!granted) return false;

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) return false;
  }

  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none"
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });
    await sleep(60);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });
    return true;
  } catch {
    return false;
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

export async function listModels(params: {
  kind?: "image" | "video";
  accountIndex?: number | null;
}): Promise<{ models: ModelOption[]; aspects: string[]; accountIndex: number | null }> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const { tabId } = await ensureProjectPageFallback(accountIndex);
  if (!tabId) {
    return { models: DEFAULT_IMAGE_MODELS, aspects: DEFAULT_ASPECTS, accountIndex };
  }
  try {
    const data = await callContent<{ models: ModelOption[]; aspects: string[] }>(tabId, "models", undefined, 30_000);
    return {
      models: params.kind === "video" ? [] : data.models,
      aspects: data.aspects,
      accountIndex
    };
  } catch {
    return { models: DEFAULT_IMAGE_MODELS, aspects: DEFAULT_ASPECTS, accountIndex };
  }
}

async function ensureProjectPageFallback(accountIndex: number | null): Promise<{ tabId: number | null }> {
  const settings = await getSettings();
  const tabId = settings.workerTabs[String(accountIndex ?? "none")];
  if (typeof tabId !== "number") return { tabId: null };
  const tab = await getTab(tabId);
  return { tabId: tab ? tabId : null };
}

export { buildProjectUrl, DEFAULT_DOWNLOAD_SUBDIR };
