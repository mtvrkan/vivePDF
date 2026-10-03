import { create } from "zustand";
import { fontFile } from "@/shared/rpc/operations";
import type { StudioElement, StudioTextElement } from "@/types/studio";

export const DEFAULT_FONT_ID = "bundled:dejavu-sans";
export const FALLBACK_STACK = "sans-serif";
const LOADABLE = new Set(["ttf", "otf", "woff", "woff2"]);

export type LoadedFace = { family: string; synthetic: boolean };

type FontsState = { faces: Record<string, LoadedFace | null> };

export const useStudioFontsStore = create<FontsState>(() => ({ faces: {} }));

const pending = new Map<string, Promise<LoadedFace | null>>();

export function faceKey(fontId: string | null, bold: boolean, italic: boolean): string {
  return `${fontId ?? DEFAULT_FONT_ID}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function familyName(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  return `vp-studio-${(hash >>> 0).toString(36)}`;
}

async function loadFace(fontId: string, bold: boolean, italic: boolean): Promise<LoadedFace | null> {
  const result = await fontFile({ id: fontId, bold, italic });
  if (italic && !result.italic) {
    const upright = await ensureFace(fontId, bold, false);
    return upright ? { family: upright.family, synthetic: true } : null;
  }
  if (!LOADABLE.has(result.ext.toLowerCase())) return null;
  const family = familyName(faceKey(fontId, bold, italic));
  const face = new FontFace(family, decode(result.base64));
  window.document.fonts.add(await face.load());
  return { family, synthetic: false };
}

export function ensureFace(fontId: string | null, bold: boolean, italic: boolean): Promise<LoadedFace | null> {
  const id = fontId ?? DEFAULT_FONT_ID;
  const key = faceKey(id, bold, italic);
  const known = useStudioFontsStore.getState().faces;
  if (key in known) return Promise.resolve(known[key]);
  let task = pending.get(key);
  if (!task) {
    task = loadFace(id, bold, italic)
      .catch(() => null)
      .then((face) => {
        useStudioFontsStore.setState((state) => ({ faces: { ...state.faces, [key]: face } }));
        pending.delete(key);
        return face;
      });
    pending.set(key, task);
  }
  return task;
}

export function textFaces(element: StudioTextElement): Array<{ bold: boolean; italic: boolean }> {
  const combos = new Map<string, { bold: boolean; italic: boolean }>();
  for (const run of element.runs) {
    const bold = run.bold ?? element.bold;
    const italic = run.italic ?? element.italic;
    combos.set(`${bold}|${italic}`, { bold, italic });
  }
  return [...combos.values()];
}

export function ensureElementFonts(elements: StudioElement[]): Promise<unknown> {
  const tasks: Promise<unknown>[] = [];
  for (const element of elements) {
    if (element.kind !== "text") continue;
    for (const combo of textFaces(element)) tasks.push(ensureFace(element.fontId, combo.bold, combo.italic));
  }
  return Promise.all(tasks);
}

export function faceCss(face: LoadedFace | null | undefined, bold: boolean, italic: boolean): { fontFamily: string; fontStyle: "normal" | "italic"; fontWeight: "normal" | "bold" } {
  if (!face) return { fontFamily: FALLBACK_STACK, fontStyle: italic ? "italic" : "normal", fontWeight: bold ? "bold" : "normal" };
  return { fontFamily: `"${face.family}", ${FALLBACK_STACK}`, fontStyle: italic && face.synthetic ? "italic" : "normal", fontWeight: "normal" };
}
