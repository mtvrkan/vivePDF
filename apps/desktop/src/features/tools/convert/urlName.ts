const UNSAFE = /[\\/:*?"<>|]+/g;
const SEPARATORS = /[\s._~-]+/g;

export function fileNameFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const absolute = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  const host = parsed.hostname.replace(/^www\./, "").replace(UNSAFE, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  const stem = last.replace(/\.[a-z0-9]{1,5}$/i, "");
  return [host, sanitize(decodeSegment(stem))].filter(Boolean).join("-").slice(0, 90);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sanitize(value: string): string {
  return value.replace(UNSAFE, "").replace(SEPARATORS, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
