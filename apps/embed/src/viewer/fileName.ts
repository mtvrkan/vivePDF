const UNSAFE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
const MAX_LENGTH = 120;
const FALLBACK = "document";

function lastSegment(src: string): string {
  try {
    return decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

export function downloadName(src: string, preferred: string | null): string {
  const raw = preferred?.trim() || lastSegment(src);
  const clean = raw.replace(UNSAFE_CHARACTERS, "_").replace(/^[._\s]+/, "").slice(0, MAX_LENGTH).trim() || FALLBACK;
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}
