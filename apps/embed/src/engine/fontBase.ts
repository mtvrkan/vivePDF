export function parseFontBase(value: string | null, documentBase: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`, documentBase);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
