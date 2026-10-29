import { formatPath, getByPath, parsePath } from "@media-mcp/shared";
import type { ReplayPlan } from "./storage.js";

interface Template {
  url: string;
  method: string;
  body: string | null;
  capturedAt: string;
}

function parseBody(template: Template): unknown | null {
  if (!template.body) return null;
  try {
    return JSON.parse(template.body);
  } catch {
    return null;
  }
}

function collectPaths(value: unknown, parts: (string | number)[], out: (string | number)[][]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPaths(item, [...parts, index], out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "recaptchaContext") continue;
    if (/token|signature|timestamp|requestId|sessionId/i.test(key)) continue;
    const next = [...parts, key];
    if (child !== null && typeof child === "object") {
      collectPaths(child, next, out);
    } else {
      out.push(next);
    }
  }
}

export function deriveReplayPlan(templates: Template[]): ReplayPlan | null {
  const candidates = templates.slice(-4);
  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    const single = candidates[0]!;
    const body = parseBody(single);
    if (!body) return null;
    const paths: (string | number)[][] = [];
    collectPaths(body, [], paths);
    const strings = paths
      .map((path) => ({ path, value: getByPath(body, formatPath(path)) }))
      .filter(
        ({ value }) =>
          typeof value === "string" &&
          value.length >= 24 &&
          !/^https?:|^data:|^[A-Za-z0-9_-]{40,}$/.test(value as string)
      )
      .sort((a, b) => (b.value as string).length - (a.value as string).length);
    const prompt = strings[0];
    if (!prompt) return null;
    return {
      url: new URL(single.url).pathname,
      promptPath: formatPath(prompt.path),
      action: "flow_image_generate"
    };
  }

  const first = candidates[candidates.length - 2]!;
  const second = candidates[candidates.length - 1]!;
  if (first.url !== second.url) return null;

  const bodyA = parseBody(first);
  const bodyB = parseBody(second);
  if (!bodyA || !bodyB) return null;

  const paths: (string | number)[][] = [];
  collectPaths(bodyA, [], paths);

  const differing: { path: (string | number)[]; a: unknown; b: unknown }[] = [];
  for (const path of paths) {
    const key = formatPath(path);
    const a = getByPath(bodyA, key);
    const b = getByPath(bodyB, key);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    differing.push({ path, a, b });
  }

  const strings = differing.filter(({ a, b }) => typeof a === "string" && typeof b === "string");
  const promptCandidate = strings
    .filter(({ a, b }) => (a as string).length >= 12 && (b as string).length >= 12)
    .sort((x, y) => (y.b as string).length - (x.b as string).length)[0];
  const aspectCandidate = strings.find(({ b }) => /^\d{1,2}:\d{1,2}$/.test(b as string));
  const countCandidate = differing.find(
    ({ b }) => typeof b === "number" && Number(b) >= 1 && Number(b) <= 8
  );

  if (!promptCandidate) return null;

  return {
    url: new URL(first.url).pathname,
    promptPath: formatPath(promptCandidate.path),
    ...(aspectCandidate ? { aspectPath: formatPath(aspectCandidate.path) } : {}),
    ...(countCandidate ? { countPath: formatPath(countCandidate.path) } : {}),
    action: "flow_image_generate"
  };
}

export { parsePath };
