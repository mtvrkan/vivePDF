export type WorkerSource = { kind: "direct"; url: string } | { kind: "stub"; code: string };

let assetBase = "";
const workerUrls = new Map<string, string>();

export function setAssetBase(base: string): void {
  if (base === assetBase) return;
  assetBase = base;
  for (const url of workerUrls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  workerUrls.clear();
}

export function assetUrl(name: string): string {
  return new URL(name, assetBase).href;
}

export function workerSource(url: string, pageOrigin: string): WorkerSource {
  if (new URL(url).origin === pageOrigin) return { kind: "direct", url };
  return { kind: "stub", code: `import ${JSON.stringify(url)};` };
}

export function workerUrl(name: string): string {
  const known = workerUrls.get(name);
  if (known) return known;
  const source = workerSource(assetUrl(name), location.origin);
  const url = source.kind === "direct" ? source.url : URL.createObjectURL(new Blob([source.code], { type: "text/javascript" }));
  workerUrls.set(name, url);
  return url;
}
