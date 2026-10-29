import {
  parseProjectId,
  sanitizeSegment,
  type ProjectInfo
} from "@media-mcp/shared";
import { resolveAccountIndex } from "./accounts.js";
import { callContent, getTab, navigateWorkerTab, sleep } from "./tabs.js";
import { ensureWorkerTab } from "./tabs.js";

export interface ProjectsResponse {
  projects: ProjectInfo[];
  accountIndex: number | null;
  pageUrl: string;
}

function accountHome(accountIndex: number | null): string {
  return accountIndex === null ? "https://flow.google.com/" : `https://flow.google.com/u/${accountIndex}/`;
}

async function scrapeProjectsWithRetry(tabId: number, attempts = 8): Promise<ProjectsResponse> {
  let projects: ProjectInfo[] = [];
  let pageUrl = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const data = await callContent<{ projects: ProjectInfo[]; href: string }>(tabId, "projects", undefined, 20_000);
    projects = data.projects;
    pageUrl = data.href;
    if (projects.length > 0) break;
    await sleep(800);
  }
  return { projects, accountIndex: null, pageUrl };
}

export async function listProjects(params: {
  accountIndex?: number | null;
  limit?: number;
}): Promise<ProjectsResponse> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const tabId = await ensureWorkerTab(accountIndex);
  const current = await getTab(tabId);
  const onProject = current?.url ? parseProjectId(current.url) !== null : false;

  if (onProject || !current?.url) {
    await navigateWorkerTab(tabId, accountHome(accountIndex));
    await sleep(1500);
  }

  const result = await scrapeProjectsWithRetry(tabId);
  const limit = params.limit ?? 50;
  return {
    projects: result.projects.slice(0, limit),
    accountIndex,
    pageUrl: result.pageUrl
  };
}

export async function createProject(params: {
  name?: string;
  accountIndex?: number | null;
}): Promise<{ projectId: string; url: string; name: string | null; accountIndex: number | null }> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const tabId = await ensureWorkerTab(accountIndex);

  const current = await getTab(tabId);
  if (!current?.url || parseProjectId(current.url) !== null) {
    await navigateWorkerTab(tabId, accountHome(accountIndex));
    await sleep(1500);
  }

  const created = await callContent<{ projectId: string; url: string; name: string | null }>(
    tabId,
    "create-project",
    undefined,
    40_000
  );

  if (params.name) {
    await sleep(500);
    const renamed = await callContent<{ renamed: boolean; name?: string | null }>(
      tabId,
      "rename-project",
      { name: params.name },
      20_000
    ).catch((): { renamed: boolean; name?: string | null } => ({ renamed: false }));
    return {
      projectId: created.projectId,
      url: created.url,
      name: renamed.name ?? params.name,
      accountIndex
    };
  }

  return { projectId: created.projectId, url: created.url, name: created.name, accountIndex };
}

export async function openProject(params: {
  projectId: string;
  accountIndex?: number | null;
  focus?: boolean;
}): Promise<{ tabId: number; url: string; projectId: string; accountIndex: number | null }> {
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const tabId = await ensureWorkerTab(accountIndex);
  const base = accountIndex === null ? "https://flow.google.com" : `https://flow.google.com/u/${accountIndex}`;
  const url = `${base}/project/${encodeURIComponent(params.projectId)}`;
  await navigateWorkerTab(tabId, url, { focus: params.focus });
  return { tabId, url, projectId: params.projectId, accountIndex };
}

export async function findOrCreateProject(
  accountIndex: number | null,
  desiredName: string
): Promise<{ projectId: string; name: string | null; created: boolean }> {
  const wanted = desiredName.trim().toLowerCase();
  const list = await listProjects({ accountIndex, limit: 100 });
  const match = list.projects.find((project) => (project.name ?? "").trim().toLowerCase() === wanted);
  if (match) return { projectId: match.projectId, name: match.name, created: false };

  const created = await createProject({
    accountIndex,
    name: sanitizeSegment(desiredName, "MCP Test")
  });
  return { projectId: created.projectId, name: created.name ?? desiredName, created: true };
}
