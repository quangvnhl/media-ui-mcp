import { parseAccountIndex, parseProjectId, type ProjectInfo } from "@media-mcp/shared";

export const PROJECT_CARD_SELECTOR = ".projects-grid-item";

const PROJECT_TITLE_CONTROLS = [
  "button",
  '[role="button"]',
  "mat-icon",
  ".google-symbols",
  ".material-icons",
  '[class*="material-icons-"]',
  ".material-symbols",
  '[class*="material-symbols-"]',
  '[aria-hidden="true"]'
].join(", ");

export function projectsFromCards(cards: Iterable<Element>, baseUrl: string): ProjectInfo[] {
  const projects = new Map<string, ProjectInfo>();
  const base = new URL(baseUrl);
  for (const card of cards) {
    const anchor = card.querySelector("a.project-thumbnail-container[href]");
    const href = anchor?.getAttribute("href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin || parseAccountIndex(url.href) !== parseAccountIndex(base.href)) continue;
    const projectId = parseProjectId(url.href);
    if (!projectId) continue;
    const title = card.querySelector(".project-title-label");
    const titleContent = title?.cloneNode(true) as Element | undefined;
    for (const control of titleContent?.querySelectorAll(PROJECT_TITLE_CONTROLS) ?? []) {
      control.remove();
    }
    const name = titleContent?.textContent?.trim() || null;
    const previous = projects.get(projectId);
    if (previous?.name && !name) continue;
    projects.set(projectId, {
      projectId,
      name,
      url: url.href,
      accountIndex: parseAccountIndex(url.href),
      updatedAt: null
    });
  }
  return [...projects.values()];
}

export function mergeProjects(target: Map<string, ProjectInfo>, projects: ProjectInfo[]): void {
  for (const project of projects) {
    const previous = target.get(project.projectId);
    if (previous?.name && !project.name) continue;
    target.set(project.projectId, project);
  }
}
