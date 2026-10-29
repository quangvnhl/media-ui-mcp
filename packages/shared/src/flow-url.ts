export interface FlowLocation {
  origin: string;
  accountIndex: number | null;
  projectId: string | null;
  url: string;
}

export function parseAccountIndex(url: string): number | null {
  const match = /\/u\/(\d+)(?:\/|$|[?#])/.exec(url);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function parseProjectId(url: string): string | null {
  const match = /\/project\/([^/?#]+)/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function parseFlowLocation(url: string): FlowLocation {
  let origin = "https://flow.google.com";
  try {
    origin = new URL(url).origin;
  } catch {
    // keep default
  }
  return {
    origin,
    accountIndex: parseAccountIndex(url),
    projectId: parseProjectId(url),
    url
  };
}

export function isFlowUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "flow.google.com" ||
      (parsed.hostname === "labs.google" && parsed.pathname.includes("/tools/flow"))
    );
  } catch {
    return false;
  }
}

export function buildAccountHomeUrl(accountIndex: number | null): string {
  return accountIndex === null
    ? "https://flow.google.com/"
    : `https://flow.google.com/u/${accountIndex}/`;
}

export function buildProjectUrl(accountIndex: number | null, projectId: string): string {
  const base =
    accountIndex === null ? "https://flow.google.com" : `https://flow.google.com/u/${accountIndex}`;
  return `${base}/project/${encodeURIComponent(projectId)}`;
}

export function parseMediaIdFromUrl(url: string): string | null {
  const named = /[?&]name=([^&#]+)/.exec(url);
  if (named?.[1]) return decodeURIComponent(named[1]);
  const pathMatch = /\/media\/([^/?#]+)/.exec(url);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  return null;
}

export function sameAccount(a: number | null, b: number | null): boolean {
  return (a ?? 0) === (b ?? 0);
}
