import { editorFont, fontFile } from "@/shared/rpc/operations";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";

const LOADABLE = new Set(["ttf", "otf"]);
const pending = new Map<string, Promise<string | null>>();
const fontFiles = new Map<string, Promise<string | null>>();
const BUNDLED_FONTS = [
  { family: "DejaVu Sans", weight: 400, url: "/fonts/DejaVuSans.ttf" },
  { family: "DejaVu Sans", weight: 700, url: "/fonts/DejaVuSans-Bold.ttf" },
] as const;
const BASE64_CHUNK = 0x8000;
const fontSources = new Map<string, string[]>();
const familyByKey = new Map<string, string>();
let fontSourceCount = 0;
let bundledFonts: Promise<boolean> | null = null;

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function embeddedFontLoadable(ext: string): boolean {
  return LOADABLE.has(ext);
}

function fontFaceRule(family: string, source: string, weight?: number): string {
  const weighted = weight === undefined ? "" : `font-weight:${weight};`;
  return `@font-face{font-family:"${family}";${weighted}src:url(${source})}`;
}

function rememberFontSource(key: string, family: string, base64: string, ext: string): void {
  fontSources.set(family, [fontFaceRule(family, `data:font/${ext};base64,${base64}`)]);
  familyByKey.set(key, family);
  fontSourceCount += 1;
}

export function fontSourceVersion(): number {
  return fontSourceCount;
}

export function fontFaceRules(families: Iterable<string>): string {
  const rules: string[] = [];
  for (const family of new Set(families)) rules.push(...(fontSources.get(family) ?? []));
  return rules.join("");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  return window.btoa(binary);
}

async function bundledFontRule(face: (typeof BUNDLED_FONTS)[number]): Promise<string> {
  const response = await fetch(face.url);
  if (!response.ok) throw new Error(`font ${face.url}: ${response.status}`);
  const base64 = encodeBase64(new Uint8Array(await response.arrayBuffer()));
  return fontFaceRule(face.family, `data:font/ttf;base64,${base64}`, face.weight);
}

export function loadBundledFontSources(): Promise<boolean> {
  bundledFonts ??= Promise.all(BUNDLED_FONTS.map(bundledFontRule))
    .then((rules) => {
      for (const face of BUNDLED_FONTS) fontSources.set(face.family, rules.filter((_rule, index) => BUNDLED_FONTS[index]?.family === face.family));
      fontSourceCount += 1;
      return true;
    })
    .catch(() => {
      bundledFonts = null;
      return false;
    });
  return bundledFonts;
}

export function bundledFontFamily(family: string): boolean {
  return BUNDLED_FONTS.some((face) => face.family === family);
}

export function blockFontXrefs(block: { fontXref: number; textLines: { runs: { fontXref: number }[] }[] }): number[] {
  const xrefs = new Set<number>();
  if (block.fontXref) xrefs.add(block.fontXref);
  for (const line of block.textLines) for (const run of line.runs) if (run.fontXref) xrefs.add(run.fontXref);
  return [...xrefs];
}

export function loadEmbeddedFont(source: { id: string; path: string; password: string | null }, xref: number, ext: string | null): Promise<string | null> {
  if (!xref || (ext !== null && !embeddedFontLoadable(ext))) return Promise.resolve(null);
  const key = `${source.id}:${xref}`;
  const known = pending.get(key);
  if (known) return known;
  const family = `vp-embedded-${xref}-${source.id.slice(0, 8)}`;
  const task = editorFont({ path: source.path, password: source.password ?? undefined, xref })
    .then(async (result) => {
      if (!embeddedFontLoadable(result.ext)) return null;
      const face = new FontFace(family, decodeBase64(result.base64));
      const loaded = await face.load();
      window.document.fonts.add(loaded);
      rememberFontSource(key, family, result.base64, result.ext);
      useViewerOverlayStore.getState().setFontFamily(key, family);
      return family;
    })
    .catch(() => null);
  pending.set(key, task);
  return task;
}

export function loadBlockFonts(source: { id: string; path: string; password: string | null }, block: { fontXref: number; fontExt: string; textLines: { runs: { fontXref: number }[] }[] }): void {
  for (const xref of blockFontXrefs(block)) void loadEmbeddedFont(source, xref, xref === block.fontXref ? block.fontExt : null);
}

export function clearEmbeddedFontCache(documentId: string): void {
  const prefix = `${documentId}:`;
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
  for (const [key, family] of familyByKey) {
    if (!key.startsWith(prefix)) continue;
    fontSources.delete(family);
    familyByKey.delete(key);
  }
}

export function fontFileKey(id: string, bold: boolean): string {
  return `font:${id}|${bold ? 1 : 0}`;
}

function familyToken(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

export function loadFontFile(id: string, bold: boolean): Promise<string | null> {
  const key = fontFileKey(id, bold);
  let task = fontFiles.get(key);
  if (!task) {
    task = fontFile({ id, bold })
      .then(async (result) => {
        if (!embeddedFontLoadable(result.ext)) return null;
        const family = `vp-font-${familyToken(key)}`;
        const face = new FontFace(family, decodeBase64(result.base64));
        const loaded = await face.load();
        window.document.fonts.add(loaded);
        rememberFontSource(key, family, result.base64, result.ext);
        return family;
      })
      .catch(() => null);
    fontFiles.set(key, task);
  }
  return task.then((family) => {
    const store = useViewerOverlayStore.getState();
    if (family && store.fontFamilies[key] !== family) store.setFontFamily(key, family);
    return family;
  });
}
