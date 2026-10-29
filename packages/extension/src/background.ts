import {
  isFlowUrl,
  PROTOCOL_VERSION,
  parseAccountIndex,
  parseProjectId,
  type Capabilities,
  type DiscoveryExport,
  type StatusResult
} from "@media-mcp/shared";
import { listAccounts, selectAccount } from "./lib/accounts.js";
import { downloadMedia } from "./lib/download.js";
import { generateImages, listModels } from "./lib/generate.js";
import { listProjectMedia, pollProjectMedia } from "./lib/media.js";
import { createProject, listProjects, openProject } from "./lib/projects.js";
import { deriveReplayPlan } from "./lib/replay.js";
import { getSettings, patchSettings, type ExtensionSettings } from "./lib/storage.js";
import {
  callContent,
  getTab
} from "./lib/tabs.js";

type BridgeState = "connected" | "connecting" | "disconnected" | "unauthorized" | "unpaired";

interface RuntimeState {
  socket: WebSocket | null;
  state: BridgeState;
  lastError: string | null;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  connectedAt: string | null;
}

const runtime: RuntimeState = {
  socket: null,
  state: "disconnected",
  lastError: null,
  reconnectAttempt: 0,
  reconnectTimer: null,
  connectedAt: null
};

const VERSION = chrome.runtime.getManifest().version;

function setState(state: BridgeState, error?: string | null): void {
  runtime.state = state;
  runtime.lastError = error ?? null;
}

async function connect(): Promise<void> {
  const settings = await getSettings();
  if (!settings.token || !settings.port) {
    setState("unpaired", "Open the extension popup and pair with the MCP server");
    return;
  }

  if (runtime.socket && (runtime.socket.readyState === WebSocket.OPEN || runtime.socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setState("connecting");
  const socket = new WebSocket(`ws://127.0.0.1:${settings.port}/ws`);
  runtime.socket = socket;

  const helloTimer = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.close(4000, "hello timeout");
  }, 6000);

  socket.onopen = () => {
    clearTimeout(helloTimer);
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "hello",
        token: settings.token,
        extensionVersion: VERSION,
        extensionId: chrome.runtime.id
      })
    );
  };

  socket.onmessage = (event) => {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const record = message as { type?: string; id?: string; method?: string; params?: unknown };
    if (record.type === "welcome") {
      runtime.reconnectAttempt = 0;
      runtime.connectedAt = new Date().toISOString();
      setState("connected");
      void chrome.action.setBadgeText({ text: "" });
      return;
    }
    if (typeof record.method === "string" && typeof record.id === "string") {
      void handleRequest(record.id, record.method, record.params);
    }
  };

  socket.onclose = (event) => {
    clearTimeout(helloTimer);
    runtime.socket = null;
    runtime.connectedAt = null;
    if (event.code === 1008) {
      setState("unauthorized", event.reason || "Server rejected the pairing token");
      void chrome.action.setBadgeText({ text: "!" });
      void chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
      return;
    }
    setState("disconnected", event.reason || "Bridge connection closed");
    void chrome.action.setBadgeText({ text: "·" });
    scheduleReconnect();
  };

  socket.onerror = () => {
    setState("disconnected", "Cannot reach the local MCP server");
  };
}

function scheduleReconnect(): void {
  if (runtime.reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** runtime.reconnectAttempt, 10_000);
  runtime.reconnectAttempt += 1;
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    void connect();
  }, delay);
}

function disconnect(): void {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
  runtime.socket?.close(1000, "client disconnect");
  runtime.socket = null;
  setState("disconnected");
}

async function handleRequest(id: string, method: string, params: unknown): Promise<void> {
  const respond = (payload: Record<string, unknown>) => {
    try {
      runtime.socket?.send(JSON.stringify({ v: PROTOCOL_VERSION, id, ...payload }));
    } catch {
      // socket died; the server will time out
    }
  };

  try {
    const result = await dispatch(method, (params ?? {}) as Record<string, unknown>);
    respond({ ok: true, result });
  } catch (error) {
    const err = error as { code?: string; message?: string; retryable?: boolean };
    respond({
      ok: false,
      error: {
        code: err.code ?? "E_INTERNAL",
        message: err.message ?? String(error),
        retryable: err.retryable ?? false
      }
    });
  }
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "status":
      return buildStatus();
    case "accounts.list":
      return listAccounts();
    case "accounts.select":
      return selectAccount({
        index: typeof params.index === "number" ? params.index : undefined,
        email: typeof params.email === "string" ? params.email : undefined,
        verify: params.verify !== false
      });
    case "models.list":
      return listModels({ kind: params.kind === "video" ? "video" : "image" });
    case "projects.list":
      return listProjects({
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined
      });
    case "projects.create":
      return createProject({
        name: typeof params.name === "string" ? params.name : undefined,
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined
      });
    case "projects.open":
      return openProject({
        projectId: String(params.projectId ?? ""),
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined,
        focus: params.focus === true
      });
    case "projects.media":
      return listProjectMedia({
        projectId: String(params.projectId ?? ""),
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined
      });
    case "media.poll":
      return pollProjectMedia({
        projectId: String(params.projectId ?? ""),
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined,
        baselineMediaIds: Array.isArray(params.baselineMediaIds)
          ? (params.baselineMediaIds as string[])
          : undefined
      });
    case "media.download":
      return downloadMedia({
        mediaId: String(params.mediaId ?? ""),
        url: typeof params.url === "string" ? params.url : undefined,
        projectId: typeof params.projectId === "string" ? params.projectId : undefined,
        projectName: typeof params.projectName === "string" ? params.projectName : undefined,
        filename: typeof params.filename === "string" ? params.filename : undefined,
        subdir: typeof params.subdir === "string" ? params.subdir : undefined,
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined
      });
    case "image.generate":
      return generateImages({
        prompt: String(params.prompt ?? ""),
        projectId: typeof params.projectId === "string" ? params.projectId : undefined,
        projectName: typeof params.projectName === "string" ? params.projectName : undefined,
        accountIndex: typeof params.accountIndex === "number" ? params.accountIndex : undefined,
        model: typeof params.model === "string" ? params.model : undefined,
        aspectRatio: typeof params.aspectRatio === "string" ? params.aspectRatio : undefined,
        count: typeof params.count === "number" ? params.count : undefined,
        strategy:
          params.strategy === "api" || params.strategy === "dom" || params.strategy === "auto"
            ? params.strategy
            : undefined,
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined
      });
    case "discovery.export":
      return exportDiscovery();
    case "selftest":
      return selftest();
    case "config.get":
      return { settings: await getSettings() };
    case "config.set":
      return patchSettings({
        ...(typeof params.downloadSubdir === "string" ? { subdir: params.downloadSubdir } : {}),
        ...(typeof params.defaultAccountIndex === "number" || params.defaultAccountIndex === null
          ? { accountIndex: params.defaultAccountIndex as number | null }
          : {})
      });
    default:
      throw Object.assign(new Error(`Unknown bridge method: ${method}`), { code: "E_BAD_INPUT" });
  }
}

async function buildStatus(): Promise<StatusResult> {
  const settings = await getSettings();
  const manifest = chrome.runtime.getManifest();
  const manifestInfo = {
    version: manifest.version,
    permissions: manifest.permissions ?? [],
    optionalPermissions: manifest.optional_permissions ?? []
  };
  const capabilities: Capabilities = {
    apiReplay: !!settings.replayPlan?.promptPath,
    domSubmit: true,
    recaptchaMint: !!settings.replayPlan?.action,
    trustedClicks: await chrome.permissions
      .contains({ permissions: ["debugger"] })
      .catch(() => false),
    hooksInstalled: false
  };

  const tab = await statusTab(settings);
  if (!tab || tab.id === undefined) {
    return {
      connected: runtime.state === "connected",
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: VERSION,
      tabId: null,
      url: null,
      accountIndex: settings.accountIndex,
      email: null,
      projectId: null,
      pageReady: false,
      hooksInstalled: false,
      capabilities,
      downloadDir: null,
      downloadSubdir: settings.subdir,
      manifest: manifestInfo
    };
  }

  let pageInfo: {
    href: string;
    accountIndex: number | null;
    projectId: string | null;
    email: string | null;
    ready: boolean;
    hooksInstalled: boolean;
  } | null = null;
  try {
    pageInfo = await callContent(tab.id, "info", undefined, 10_000);
  } catch {
    pageInfo = null;
  }

  return {
    connected: runtime.state === "connected",
    protocolVersion: PROTOCOL_VERSION,
    extensionVersion: VERSION,
    tabId: tab.id,
    url: pageInfo?.href ?? tab.url ?? null,
    accountIndex:
      pageInfo?.accountIndex ?? parseAccountIndex(tab.url ?? "") ?? settings.accountIndex,
    email: pageInfo?.email ?? null,
    projectId: pageInfo?.projectId ?? parseProjectId(tab.url ?? ""),
    pageReady: pageInfo?.ready ?? false,
    hooksInstalled: pageInfo?.hooksInstalled ?? false,
    capabilities: { ...capabilities, hooksInstalled: pageInfo?.hooksInstalled ?? false },
    downloadDir: null,
    downloadSubdir: settings.subdir,
    manifest: manifestInfo
  };
}

async function statusTab(settings: ExtensionSettings): Promise<chrome.tabs.Tab | null> {
  const keyed = settings.workerTabs[String(settings.accountIndex ?? "none")];
  if (typeof keyed === "number") {
    const tab = await getTab(keyed);
    if (tab) return tab;
  }
  const active = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (active && parseAccountIndex(active.url ?? "") !== null) return active;
  const flowTabs = (await chrome.tabs.query({})).filter(
    (tab) => tab.id !== undefined && isFlowUrl(tab.url)
  );
  return flowTabs[0] ?? null;
}

async function exportDiscovery(): Promise<{
  export: DiscoveryExport;
  plan: ReturnType<typeof deriveReplayPlan>;
}> {
  const settings = await getSettings();
  const tab = await statusTab(settings);
  if (!tab?.id) throw Object.assign(new Error("No Flow tab available"), { code: "E_NO_TAB" });

  const capture = await callContent<DiscoveryExport & { templates: { body: string | null }[] }>(
    tab.id,
    "capture",
    undefined,
    30_000
  );

  let plan = deriveReplayPlan(capture.templates as never);
  if (!plan && settings.replayPlan) plan = settings.replayPlan;
  if (plan) await patchSettings({ replayPlan: plan });

  return { export: capture as DiscoveryExport, plan };
}

async function selftest(): Promise<{
  ok: boolean;
  bridge: { state: BridgeState; connectedAt: string | null };
  checks: { id: string; ok: boolean; detail: string }[];
  page: unknown;
  frames: unknown;
}> {
  const settings = await getSettings();
  const tab = await statusTab(settings);
  const checks: { id: string; ok: boolean; detail: string }[] = [
    {
      id: "bridge",
      ok: runtime.state === "connected",
      detail: `bridge ${runtime.state}${runtime.lastError ? `: ${runtime.lastError}` : ""}`
    },
    {
      id: "pairing",
      ok: !!settings.token && !!settings.port,
      detail: settings.token ? `paired on port ${settings.port}` : "not paired"
    },
    {
      id: "worker-tab",
      ok: !!tab?.id,
      detail: tab?.id ? `tab ${tab.id} at ${tab.url}` : "no Flow tab"
    },
    {
      id: "replay-plan",
      ok: !!settings.replayPlan?.promptPath,
      detail: settings.replayPlan?.promptPath
        ? `prompt path ${settings.replayPlan.promptPath}`
        : "no replay plan yet (DOM submit will be used)"
    },
    {
      id: "debugger",
      ok: await chrome.permissions.contains({ permissions: ["debugger"] }).catch(() => false),
      detail: "optional trusted-click permission"
    }
  ];

  let page: unknown = null;
  if (tab?.id) {
    try {
      page = await callContent(tab.id, "selftest", undefined, 30_000);
    } catch (error) {
      page = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  let frames: unknown = null;
  if (tab?.id) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const labels = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .slice(0, 6)
            .map((el) => (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 24))
            .filter(Boolean);
          return {
            href: location.href.slice(0, 110),
            imgs: document.querySelectorAll("img").length,
            mediaish: document.querySelectorAll(
              'img[src*="flow-content"], img[src*="googleusercontent"]'
            ).length,
            textareas: document.querySelectorAll('textarea, [contenteditable="true"]').length,
            buttons: document.querySelectorAll('button, [role="button"]').length,
            labels
          };
        }
      });
      frames = results.map((entry) => ({ frameId: entry.frameId, ...entry.result }));
    } catch (error) {
      frames = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    ok: checks.filter((check) => check.id !== "replay-plan" && check.id !== "debugger").every((check) => check.ok),
    bridge: { state: runtime.state, connectedAt: runtime.connectedAt },
    checks,
    page,
    frames
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as { kind?: string } | undefined;
  if (!msg?.kind) return false;

  if (msg.kind === "popup.status") {
    void (async () => {
      const settings = await getSettings();
      sendResponse({
        bridge: runtime.state,
        error: runtime.lastError,
        connectedAt: runtime.connectedAt,
        version: VERSION,
        settings,
        port: settings.port
      });
    })();
    return true;
  }

  if (msg.kind === "bridge.reconnect") {
    runtime.reconnectAttempt = 0;
    disconnect();
    void connect();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.kind === "bridge.disconnect") {
    disconnect();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.alarms.create("flow-mcp-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flow-mcp-keepalive") {
    if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) {
      runtime.reconnectAttempt = 0;
      void connect();
    }
  }
});

chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const settings = await getSettings();
    const workerTabs = { ...settings.workerTabs };
    let changed = false;
    for (const [key, value] of Object.entries(workerTabs)) {
      if (value === tabId) {
        delete workerTabs[key];
        changed = true;
      }
    }
    if (changed) await patchSettings({ workerTabs });
  })();
});

void connect();
