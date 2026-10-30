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
  warnings: string[];
  hasMore: boolean | null;
  nextCursor: null;
}

function accountHome(accountIndex: number | null): string {
  return accountIndex === null ? "https://flow.google.com/" : `https://flow.google.com/u/${accountIndex}/`;
}

async function scrapeProjectList(tabId: number, limit: number): Promise<ProjectsResponse> {
  const data = await callContent<{ projects: ProjectInfo[]; href: string; cardCount: number; projectLinkCount: number }>(tabId, "projects", { limit }, 16_000);
  const { projects, cardCount, projectLinkCount } = data;
  if (projects.length === 0 && (cardCount > 0 || projectLinkCount > 0)) {
    throw Object.assign(new Error("Flow project cards could not be read; expected .projects-grid-item, a.project-thumbnail-container and .project-title-label"), { code: "E_UI_DRIFT" });
  }
  const warnings = ["Projects were collected from rendered cards with bounded scrolling. Completeness is not verified; absence from this list does not prove a project does not exist."];
  const unnamed = projects.filter((project) => project.name === null).length;
  if (unnamed > 0) warnings.push(`${unnamed} project(s) have no readable title after waiting for rendering.`);
  if (projects.length === 0) warnings.push("No project cards appeared; the page may be empty or still loading.");
  return { projects, accountIndex: null, pageUrl: data.href, warnings, hasMore: null, nextCursor: null };
}

export async function listProjects(params: {
  accountIndex?: number | null;
  limit?: number;
  cursor?: string;
}): Promise<ProjectsResponse> {
  if (params.cursor !== undefined) {
    throw Object.assign(new Error("Project pagination cursors are not supported; only rendered cards can currently be listed."), { code: "E_UNSUPPORTED" });
  }
  const accountIndex = await resolveAccountIndex(params.accountIndex);
  const tabId = await ensureWorkerTab(accountIndex);
  const current = await getTab(tabId);
  const onProject = current?.url ? parseProjectId(current.url) !== null : false;

  if (onProject || !current?.url) {
    await navigateWorkerTab(tabId, accountHome(accountIndex));
    await sleep(1500);
  }

  const limit = params.limit ?? 50;
  const result = await scrapeProjectList(tabId, limit);
  return {
    ...result,
    projects: result.projects.slice(0, limit),
    hasMore: result.projects.length > limit ? true : result.hasMore,
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
  const wanted = desiredName.normalize("NFC").trim().toLowerCase();
  const list = await listProjects({ accountIndex, limit: 100 });
  const matches = list.projects.filter((project) => (project.name ?? "").normalize("NFC").trim().toLowerCase() === wanted);
  if (matches.length > 1) {
    throw Object.assign(new Error(`Multiple projects are named "${desiredName}"; select one by projectId.`), { code: "E_BAD_INPUT" });
  }
  const match = matches[0];
  if (match) return { projectId: match.projectId, name: match.name, created: false };

  if (list.hasMore !== false || list.projects.some((project) => project.name === null)) {
    throw Object.assign(new Error(`Cannot confirm that project "${desiredName}" is absent from the rendered project list; open it by URL or create it explicitly.`), { code: "E_PAGE_NOT_READY" });
  }

  const created = await createProject({
    accountIndex,
    name: sanitizeSegment(desiredName, "MCP Test")
  });
  return { projectId: created.projectId, name: created.name ?? desiredName, created: true };
}
