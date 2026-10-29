import type { MediaItem } from "@media-mcp/shared";
import { resolveAccountIndex } from "./accounts.js";
import { callContent, ensureProjectPage } from "./tabs.js";

export interface MediaResponse {
  projectId: string;
  items: MediaItem[];
  pageUrl: string;
  capturedAt: string;
}

interface PageMedia {
  items: MediaItem[];
  pageUrl: string;
  projectId: string | null;
}

export async function listProjectMedia(params: {
  projectId: string;
  accountIndex?: number | null;
}): Promise<MediaResponse> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const { tabId, url } = await ensureProjectPage(accountIndex, params.projectId);
  const page = await callContent<PageMedia>(tabId, "media", undefined, 45_000);
  return {
    projectId: params.projectId,
    items: page.items,
    pageUrl: page.pageUrl || url,
    capturedAt: new Date().toISOString()
  };
}

export async function pollProjectMedia(params: {
  projectId: string;
  accountIndex?: number | null;
  baselineMediaIds?: string[];
}): Promise<MediaResponse & { freshCount: number }> {
  const result = await listProjectMedia({
    projectId: params.projectId,
    accountIndex: params.accountIndex
  });
  const baseline = new Set(params.baselineMediaIds ?? []);
  const freshCount = result.items.filter((item) => !baseline.has(item.mediaId)).length;
  return { ...result, freshCount };
}

export function pickMedia(items: MediaItem[], mediaId: string): MediaItem | null {
  return items.find((item) => item.mediaId === mediaId) ?? null;
}
