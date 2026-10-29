const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeSegment(input: string, fallback = "untitled"): string {
  let value = (input || "").replace(ILLEGAL_CHARS, "_").replace(/\s+/g, " ").trim();
  value = value.replace(/^\.+/, "").replace(/\.+$/, "");
  value = value.slice(0, 96);
  if (!value) value = fallback;
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  return value;
}

export function sanitizeRelativeSubdir(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const parts = input
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .map((part) => sanitizeSegment(part, "flow"));
  return parts.length ? parts.join("/") : fallback;
}

export function extensionForMime(mime: string, kind: string): string {
  const normalized = (mime || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("audio")) return "wav";
  return kind === "video" ? "mp4" : kind === "audio" ? "wav" : "jpg";
}

export function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
