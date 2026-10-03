import { fontFile } from "@/shared/rpc/operations";

const LOADABLE = new Set(["ttf", "otf", "woff", "woff2"]);
const VARIANTS = [
  { bold: false, italic: false },
  { bold: true, italic: false },
  { bold: false, italic: true },
  { bold: true, italic: true },
] as const;

const loading = new Map<string, Promise<void>>();

export function fontFamilyFor(fontId: string): string {
  let hash = 0;
  for (let index = 0; index < fontId.length; index += 1) hash = (Math.imul(hash, 31) + fontId.charCodeAt(index)) | 0;
  return `vp-doc-${(hash >>> 0).toString(36)}`;
}

export function fontStack(fontId: string | null | undefined): string {
  return fontId ? `"${fontFamilyFor(fontId)}", sans-serif` : "sans-serif";
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadVariant(fontId: string, bold: boolean, italic: boolean): Promise<void> {
  const result = await fontFile({ id: fontId, bold, italic });
  if ((italic && !result.italic) || !LOADABLE.has(result.ext.toLowerCase())) return;
  const face = new FontFace(fontFamilyFor(fontId), decode(result.base64), { weight: bold ? "700" : "400", style: italic ? "italic" : "normal" });
  window.document.fonts.add(await face.load());
}

export function loadDocumentFont(fontId: string): Promise<void> {
  const running = loading.get(fontId);
  if (running) return running;
  const task = Promise.all(VARIANTS.map((variant) => loadVariant(fontId, variant.bold, variant.italic).catch(() => undefined))).then(() => undefined);
  loading.set(fontId, task);
  return task;
}
