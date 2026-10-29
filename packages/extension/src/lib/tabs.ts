import { isFlowUrl, parseAccountIndex, type StatusResult } from "@media-mcp/shared";
import { getSettings, patchSettings } from "./storage.js";

export interface ContentError {
  code: string;
  message: string;
}

export interface ContentResponse<T> {
  ok: boolean;
  result?: T;
  error?: ContentError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const frameCache = new Map<number, number>();

export function forgetFrame(tabId: number): void {
  frameCache.delete(tabId);
}

async function resolveFrame(tabId: number): Promise<number> {
  const cached = frameCache.get(tabId);
  if (cached !== undefined) return cached;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const composer = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        const media = document.querySelectorAll(
          'img[src*="flow-content"], img[src*="googleusercontent"], video'
        ).length;
        return Boolean(composer) || media > 1;
      }
    });
    const hit = results.find((entry) => entry.result === true);
    const frameId = hit?.frameId ?? 0;
    frameCache.set(tabId, frameId);
    return frameId;
  } catch {
    return 0;
  }
}

export async function callContent<T>(
  tabId: number,
  method: string,
  params?: unknown,
  timeoutMs = 30_000
): Promise<T> {
  const message = { kind: "flow.rpc", id: crypto.randomUUID(), method, params, timeoutMs };
  let transient: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const frameId = await ensureContent(tabId);
    let response: ContentResponse<T> | undefined;
    try {
      response = (await chrome.tabs.sendMessage(tabId, message, { frameId })) as
        | ContentResponse<T>
        | undefined;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (attempt === 0 && /channel closed|port closed|Receiving end does not exist|frame was removed|context invalidated|No response/i.test(text)) {
        transient = error;
        forgetFrame(tabId);
        await sleep(900);
        continue;
      }
      throw Object.assign(new Error(`Extension call "${method}" failed: ${text}`), { code: "E_PAGE_NOT_READY" });
    }
    if (!response) {
      throw Object.assign(new Error("No response from the Flow content script"), { code: "E_PAGE_NOT_READY" });
    }
    if (!response.ok) {
      throw Object.assign(new Error(response.error?.message ?? "Page call failed"), {
        code: response.error?.code ?? "E_INTERNAL"
      });
    }
    return response.result as T;
  }

  throw Object.assign(
    new Error(transient instanceof Error ? transient.message : "The Flow page kept dropping the call"),
    { code: "E_PAGE_NOT_READY" }
  );
}

export async function ensureContent(tabId: number): Promise<number> {
  const frameId = await resolveFrame(tabId);
  try {
    const pong = (await chrome.tabs.sendMessage(
      tabId,
      { kind: "flow.rpc", id: crypto.randomUUID(), method: "ping", timeoutMs: 5000 },
      { frameId }
    )) as ContentResponse<unknown> | undefined;
    if (pong && pong.ok) return frameId;
  } catch {
    // inject below
  }

  const target = { tabId, frameIds: [frameId] };
  try {
    await chrome.scripting.executeScript({
      target,
      files: ["main-world.js"],
      world: "MAIN"
    } as chrome.scripting.ScriptInjection<unknown[], unknown>);
  } catch {
    // page may already have hooks; isolated injection is the important one
  }
  try {
    await chrome.scripting.executeScript({ target, files: ["isolated.js"] });
  } catch {
    // frame may be sandboxed; the declared content script may still be present
  }
  await sleep(250);
  return frameId;
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

export async function waitForTab(
  tabId: number,
  predicate: (tab: chrome.tabs.Tab) => boolean,
  timeoutMs = 45_000
): Promise<chrome.tabs.Tab> {
  const existing = await getTab(tabId);
  if (existing && predicate(existing)) return existing;

  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    let settled = false;
    const finish = (tab: chrome.tabs.Tab) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      resolve(tab);
    };
    const listener = (updatedId: number, _info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedId === tabId && predicate(tab)) finish(tab);
    };
    const onRemoved = (removedId: number) => {
      if (removedId !== tabId || settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      reject(Object.assign(new Error("Tab was closed"), { code: "E_NO_TAB" }));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      reject(Object.assign(new Error("Timed out waiting for the Flow tab to load"), { code: "E_TIMEOUT" }));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function findFlowTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.id !== undefined && isFlowUrl(tab.url));
}

function workerKey(index: number | null): string {
  return String(index ?? "none");
}

export async function ensureWorkerTab(accountIndex: number | null): Promise<number> {
  const settings = await getSettings();
  const key = workerKey(accountIndex);
  const existingId = settings.workerTabs[key];

  if (typeof existingId === "number") {
    const tab = await getTab(existingId);
    if (tab?.id !== undefined && isFlowUrl(tab.url)) {
      try {
        await chrome.tabs.update(tab.id, { autoDiscardable: false });
      } catch {
        // ignore
      }
      return tab.id;
    }
  }

  const url =
    accountIndex === null ? "https://flow.google.com/" : `https://flow.google.com/u/${accountIndex}/`;
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) {
    throw Object.assign(new Error("Could not create a worker tab"), { code: "E_NO_TAB" });
  }
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch {
    // ignore
  }

  const workerTabs = { ...settings.workerTabs, [key]: tab.id };
  await patchSettings({ workerTabs });

  await waitForTab(tab.id, (candidate) => candidate.status === "complete" && isFlowUrl(candidate.url), 60_000);
  await sleep(1200);
  return tab.id;
}

export async function navigateWorkerTab(
  tabId: number,
  url: string,
  options: { focus?: boolean } = {}
): Promise<chrome.tabs.Tab> {
  const current = await getTab(tabId);
  if (current?.url === url) {
    if (options.focus) await chrome.tabs.update(tabId, { active: true });
    return current;
  }
  await chrome.tabs.update(tabId, { url, ...(options.focus ? { active: true } : {}) });
  forgetFrame(tabId);
  const tab = await waitForTab(
    tabId,
    (candidate) => candidate.status === "complete" && (candidate.url ?? "").startsWith("https://flow.google.com"),
    60_000
  );
  await sleep(1500);
  return tab;
}

export async function ensureProjectPage(
  accountIndex: number | null,
  projectId: string,
  focus = false
): Promise<{ tabId: number; url: string }> {
  const base =
    accountIndex === null ? "https://flow.google.com" : `https://flow.google.com/u/${accountIndex}`;
  const url = `${base}/project/${encodeURIComponent(projectId)}`;
  const tabId = await ensureWorkerTab(accountIndex);
  const current = await getTab(tabId);
  if (current?.url === url) {
    if (focus) await chrome.tabs.update(tabId, { active: true });
  } else {
    await navigateWorkerTab(tabId, url, { focus });
  }
  await waitForPageReady(tabId);
  return { tabId, url };
}

export async function waitForPageReady(tabId: number, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const info = await callContent<{ href: string; ready: boolean }>(tabId, "info", undefined, 8000);
      if (info.ready) return;
      lastError = new Error("Flow editor is still loading");
    } catch (error) {
      lastError = error;
    }
    await sleep(700);
  }
  throw Object.assign(
    new Error(
      `Flow page did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    ),
    { code: "E_PAGE_NOT_READY" }
  );
}

export async function getPageInfo(tabId: number): Promise<{
  href: string;
  origin: string;
  title: string;
  accountIndex: number | null;
  projectId: string | null;
  projectName: string | null;
  email: string | null;
  ready: boolean;
  hooksInstalled: boolean;
}> {
  return callContent(tabId, "info", undefined, 15_000);
}

export async function pickStatusTab(accountIndex: number | null): Promise<chrome.tabs.Tab | null> {
  if (accountIndex !== null) {
    const tabId = await ensureWorkerTab(accountIndex).catch(() => null);
    if (tabId !== null) return getTab(tabId);
  }
  const flowTabs = await findFlowTabs();
  const known = new Set(Object.values((await getSettings()).workerTabs));
  return flowTabs.find((tab) => tab.id !== undefined && known.has(tab.id)) ?? flowTabs[0] ?? null;
}

export async function describeTab(tabId: number): Promise<Partial<StatusResult>> {
  const tab = await getTab(tabId);
  if (!tab) return {};
  return {
    tabId,
    url: tab.url ?? null,
    accountIndex: parseAccountIndex(tab.url ?? "")
  };
}
