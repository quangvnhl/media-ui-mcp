export type PathPart = string | number;

const BRACKET = /\[(?:(-?\d+)|"((?:[^"\\]|\\.)*)")\]/g;

export function parsePath(path: string): PathPart[] {
  const parts: PathPart[] = [];
  let match: RegExpExecArray | null;
  BRACKET.lastIndex = 0;
  while ((match = BRACKET.exec(path)) !== null) {
    if (match[1] !== undefined) parts.push(Number(match[1]));
    else parts.push((match[2] as string).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  if (parts.length === 0) {
    return path.split(".").filter(Boolean);
  }
  return parts;
}

export function getByPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of parsePath(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PathPart, unknown>)[part];
  }
  return current;
}

export function setByPath(value: unknown, path: string, next: unknown): boolean {
  const parts = parsePath(path);
  if (parts.length === 0) return false;
  let current: unknown = value;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const child = (current as Record<PathPart, unknown> | null)?.[part];
    if (!child || typeof child !== "object") return false;
    current = child;
  }
  const last = parts[parts.length - 1]!;
  if (current === null || typeof current !== "object") return false;
  (current as Record<PathPart, unknown>)[last] = next;
  return true;
}

export function formatPath(parts: PathPart[]): string {
  return parts
    .map((part) => (typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`))
    .join("");
}
