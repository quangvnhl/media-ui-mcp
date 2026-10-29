import {
  extensionForMime,
  parseAccountIndex,
  sanitizeRelativeSubdir,
  sanitizeSegment,
  timestampSlug,
  type MediaItem
} from "@media-mcp/shared";
import { getSettings } from "./storage.js";
import { callContent, ensureProjectPage, getTab, sleep } from "./tabs.js";
import { listProjectMedia } from "./media.js";

export interface DownloadResult {
  mediaId: string;
  path: string;
  filename: string;
  bytes: number;
  mime: string;
  downloadId: number;
}

let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const api = chrome.offscreen as unknown as { hasDocument?: () => Promise<boolean> };
  try {
    return api.hasDocument ? await api.hasDocument() : false;
  } catch {
    return false;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Fetch Flow media into a blob so it can be saved to disk"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/single offscreen/i.test(message)) throw error;
    }
  })();
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

interface OffscreenFetchResult {
  ok: boolean;
  blobUrl?: string;
  dataUrl?: string;
  mime?: string;
  bytes?: number;
  error?: string;
}

async function callOffscreen(message: Record<string, unknown>): Promise<OffscreenFetchResult> {
  await ensureOffscreen();
  const response = (await chrome.runtime.sendMessage({ target: "offscreen", ...message })) as
    | OffscreenFetchResult
    | undefined;
  if (!response) {
    throw Object.assign(new Error("Offscreen document did not respond"), { code: "E_DOWNLOAD_FAILED" });
  }
  return response;
}

function mediaRedirectUrl(accountIndex: number | null, mediaId: string): string {
  const base = accountIndex === null ? "https://flow.google.com" : `https://flow.google.com/u/${accountIndex}`;
  return `${base}/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`;
}

async function resolveMediaUrl(params: {
  mediaId: string;
  url?: string;
  projectId?: string;
  accountIndex?: number | null;
}): Promise<{ url: string; item: MediaItem | null; accountIndex: number | null }> {
  if (params.url) return { url: params.url, item: null, accountIndex: params.accountIndex ?? null };

  if (params.projectId) {
    const media = await listProjectMedia({
      projectId: params.projectId,
      accountIndex: params.accountIndex
    });
    const item = media.items.find((candidate) => candidate.mediaId === params.mediaId);
    if (item?.url) return { url: item.url, item, accountIndex: params.accountIndex ?? null };
  }

  const settings = await getSettings();
  const accountIndex = params.accountIndex ?? settings.accountIndex ?? null;
  const tabId = settings.workerTabs[String(accountIndex ?? "none")];

  if (typeof tabId === "number") {
    const tab = await getTab(tabId);
    if (tab) {
      try {
        const page = await callContent<{ items: MediaItem[] }>(tabId, "media", undefined, 20_000);
        const item = page.items.find((candidate) => candidate.mediaId === params.mediaId);
        if (item?.url) return { url: item.url, item, accountIndex };
      } catch {
        // fall through to redirect URL
      }
    }
  }

  return { url: mediaRedirectUrl(accountIndex, params.mediaId), item: null, accountIndex };
}

function buildFilename(params: {
  mediaId: string;
  mime: string;
  filename?: string;
  subdir?: string;
  projectName?: string;
  model?: string | null;
}): string {
  const subdir = sanitizeRelativeSubdir(params.subdir, "Flow");
  const project = sanitizeSegment(params.projectName ?? "flow", "flow");
  const ext = extensionForMime(params.mime, "image");
  const base = params.filename
    ? sanitizeSegment(params.filename.replace(/\.[A-Za-z0-9]{1,5}$/, ""), "image")
    : `${timestampSlug()}_${params.mediaId.slice(0, 8)}`;
  return `${subdir}/${project}/${base}.${ext}`;
}

async function waitForDownload(downloadId: number, timeoutMs = 120_000): Promise<chrome.downloads.DownloadItem> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (!item) {
      throw Object.assign(new Error("Download item disappeared"), { code: "E_DOWNLOAD_FAILED" });
    }
    if (item.state === "complete") return item;
    if (item.state === "interrupted") {
      throw Object.assign(new Error(`Download interrupted: ${item.error ?? "unknown"}`), {
        code: "E_DOWNLOAD_FAILED"
      });
    }
    await sleep(300);
  }
  throw Object.assign(new Error("Download did not finish in time"), { code: "E_TIMEOUT" });
}

async function pageDataUrl(
  url: string,
  accountIndex: number | null
): Promise<OffscreenFetchResult> {
  const settings = await getSettings();
  const tabId = settings.workerTabs[String(accountIndex ?? "none")];
  if (typeof tabId !== "number") {
    return { ok: false, error: "No Flow tab is available to read the blob URL" };
  }
  try {
    const data = await callContent<{ dataUrl: string; mime: string; bytes: number }>(
      tabId,
      "fetch-as-dataurl",
      { url },
      60_000
    );
    return { ok: true, dataUrl: data.dataUrl, mime: data.mime, bytes: data.bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function downloadMedia(params: {
  mediaId: string;
  url?: string;
  projectId?: string;
  projectName?: string;
  filename?: string;
  subdir?: string;
  accountIndex?: number | null;
}): Promise<DownloadResult> {
  const resolved = await resolveMediaUrl(params);
  const sameOrigin = /^https:\/\/flow\.google\.com\//i.test(resolved.url);
  let fetched: OffscreenFetchResult;
  if (resolved.url.startsWith("blob:") || sameOrigin) {
    fetched = await pageDataUrl(resolved.url, resolved.accountIndex);
    if (!fetched.ok && sameOrigin) {
      fetched = await callOffscreen({ type: "fetch", url: resolved.url });
    }
  } else {
    fetched = await callOffscreen({ type: "fetch", url: resolved.url });
  }

  if (!fetched.ok || (!fetched.blobUrl && !fetched.dataUrl)) {
    throw Object.assign(new Error(fetched.error ?? "Could not fetch the media file"), {
      code: "E_DOWNLOAD_FAILED"
    });
  }

  const mime = fetched.mime ?? "application/octet-stream";
  const filename = buildFilename({
    mediaId: params.mediaId,
    mime,
    filename: params.filename,
    subdir: params.subdir,
    projectName: params.projectName,
    model: resolved.item?.model ?? null
  });

  let downloadId: number;
  let item: chrome.downloads.DownloadItem;

  const save = async (source: string): Promise<{ downloadId: number; item: chrome.downloads.DownloadItem }> => {
    const id = await chrome.downloads.download({
      url: source,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    return { downloadId: id, item: await waitForDownload(id) };
  };

  try {
    if (fetched.blobUrl) {
      ({ downloadId, item } = await save(fetched.blobUrl));
    } else if (fetched.dataUrl) {
      ({ downloadId, item } = await save(fetched.dataUrl));
    } else {
      throw new Error("no media source");
    }
  } catch (error) {
    if (!fetched.blobUrl) throw error;
    const dataUrlResult = await callOffscreen({ type: "fetch-dataurl", url: resolved.url });
    if (!dataUrlResult.ok || !dataUrlResult.dataUrl) {
      throw Object.assign(
        new Error(
          `Blob download failed (${error instanceof Error ? error.message : String(error)}) and the data URL fallback was unavailable`
        ),
        { code: "E_DOWNLOAD_FAILED" }
      );
    }
    ({ downloadId, item } = await save(dataUrlResult.dataUrl));
  }
  if (fetched.blobUrl) {
    await callOffscreen({ type: "revoke", url: fetched.blobUrl }).catch(() => undefined);
  }

  return {
    mediaId: params.mediaId,
    path: item.filename,
    filename: item.filename.split(/[\\/]/).pop() ?? filename,
    bytes: item.fileSize ?? item.totalBytes ?? fetched.bytes ?? 0,
    mime,
    downloadId
  };
}

export async function resolveCurrentAccountIndex(tabId: number): Promise<number | null> {
  const tab = await getTab(tabId);
  return parseAccountIndex(tab?.url ?? "");
}

export { ensureProjectPage };
