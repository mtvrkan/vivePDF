const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeExternalUrl(uri: string, base: string): string | null {
  try {
    const url = new URL(uri.trim(), base);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
