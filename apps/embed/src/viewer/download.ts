const DOWNLOADABLE = new Set(["http:", "https:", "blob:"]);
const REVOKE_AFTER_MS = 60_000;

export function downloadableUrl(src: string, base: string): string | null {
  try {
    const url = new URL(src, base);
    return DOWNLOADABLE.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function savesDirectly(href: string, pageOrigin: string): boolean {
  const url = new URL(href);
  return url.protocol === "blob:" || url.origin === pageOrigin;
}

export function clickDownload(href: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
}

export async function downloadThroughBlob(href: string, fileName: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(href, { signal });
  if (!response.ok) throw new Error(`download answered ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  clickDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
