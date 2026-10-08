import { create } from "zustand";
import { fontFile } from "@/shared/rpc/operations";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import type { StudioElement, StudioTextElement } from "@/types/studio";
import { BOLD_FROM, DEFAULT_TEXT_FONT_ID, REGULAR_WEIGHT, splitParagraphs, weightOf } from "../model/typography";
import { runStyle } from "./richText";

export const DEFAULT_FONT_ID = DEFAULT_TEXT_FONT_ID;
export const FALLBACK_STACK = "sans-serif";
const LOADABLE = new Set(["ttf", "otf", "woff", "woff2"]);

export type LoadedFace = { family: string; synthetic: boolean };
export type FaceSpec = { fontId: string; weight: number; italic: boolean };

type FontsState = { faces: Record<string, LoadedFace | null> };

export const useStudioFontsStore = create<FontsState>(() => ({ faces: {} }));

const pending = new Map<string, Promise<LoadedFace | null>>();
const settled = new Map<string, LoadedFace | null>();
let generation = 0;

function publishSettled() {
  if (!settled.size) return;
  const batch = Object.fromEntries(settled);
  settled.clear();
  useStudioFontsStore.setState((state) => ({ faces: { ...state.faces, ...batch } }));
}

function settleFace(key: string, face: LoadedFace | null) {
  if (!settled.size) queueMicrotask(publishSettled);
  settled.set(key, face);
}

export function faceKey(fontId: string | null, weight: number, italic: boolean): string {
  return `${fontId ?? DEFAULT_FONT_ID}|${weight}|${italic ? 1 : 0}`;
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
  return `vp-studio-${(hash >>> 0).toString(36)}-${generation}`;
}

async function loadFace(fontId: string, weight: number, italic: boolean): Promise<LoadedFace | null> {
  const bold = weight >= BOLD_FROM;
  const explicit = weight !== REGULAR_WEIGHT && weight !== 700;
  const result = await fontFile({ id: fontId, bold, italic, ...(explicit ? { weight } : {}) });
  if (italic && !result.italic) {
    const upright = await ensureFace(fontId, weight, false);
    return upright ? { family: upright.family, synthetic: true } : null;
  }
  if (!LOADABLE.has(result.ext.toLowerCase())) return null;
  const family = familyName(faceKey(fontId, weight, italic));
  const face = new FontFace(family, decode(result.base64));
  window.document.fonts.add(await face.load());
  return { family, synthetic: false };
}

export function ensureFace(fontId: string | null, weight: number, italic: boolean): Promise<LoadedFace | null> {
  const id = fontId ?? DEFAULT_FONT_ID;
  const key = faceKey(id, weight, italic);
  const known = useStudioFontsStore.getState().faces;
  if (key in known) return Promise.resolve(known[key]);
  if (settled.has(key)) return Promise.resolve(settled.get(key) ?? null);
  const running = pending.get(key);
  if (running) return running;
  const task: Promise<LoadedFace | null> = loadFace(id, weight, italic)
    .catch(() => null)
    .then((face) => {
      if (pending.get(key) !== task) return face;
      pending.delete(key);
      settleFace(key, face);
      return face;
    });
  pending.set(key, task);
  return task;
}

function fontIdOf(key: string): string {
  return key.slice(0, key.indexOf("|"));
}

export function forgetFonts(matches: (fontId: string) => boolean) {
  generation += 1;
  for (const key of [...pending.keys()]) if (matches(fontIdOf(key))) pending.delete(key);
  for (const key of [...settled.keys()]) if (matches(fontIdOf(key))) settled.delete(key);
  useStudioFontsStore.setState((state) => ({ faces: Object.fromEntries(Object.entries(state.faces).filter(([key]) => !matches(fontIdOf(key)))) }));
}

useFontLibraryStore.subscribe(() => forgetFonts((fontId) => fontId.startsWith("library:")));

export function markerFace(kind: string, first: { fontId: string; weight: number }): FaceSpec {
  return kind === "check" ? { fontId: DEFAULT_FONT_ID, weight: REGULAR_WEIGHT, italic: false } : { fontId: first.fontId, weight: first.weight, italic: false };
}

export function textFaces(element: StudioTextElement): FaceSpec[] {
  const combos = new Map<string, FaceSpec>();
  const add = (spec: FaceSpec) => combos.set(faceKey(spec.fontId, spec.weight, spec.italic), spec);
  for (const run of element.runs) {
    const style = runStyle(element, run);
    add({ fontId: style.fontId, weight: weightOf(style.bold, style.weight), italic: style.italic });
  }
  for (const paragraph of splitParagraphs(element.runs, element.paragraphs)) {
    if (paragraph.paragraph.list === "none") continue;
    const style = runStyle(element, paragraph.runs[0] ?? { text: "" });
    add(markerFace(paragraph.paragraph.list, { fontId: style.fontId, weight: weightOf(style.bold, style.weight) }));
  }
  return [...combos.values()];
}

export function elementFaceSignature(element: StudioTextElement, faces: Record<string, LoadedFace | null>): string {
  return textFaces(element)
    .map((spec) => {
      const key = faceKey(spec.fontId, spec.weight, spec.italic);
      return key in faces ? `${key}=${faces[key]?.family ?? ""}` : key;
    })
    .join(";");
}

export function ensureElementFonts(elements: StudioElement[]): Promise<unknown> {
  const tasks: Promise<unknown>[] = [];
  for (const element of elements) {
    if (element.kind !== "text") continue;
    for (const spec of textFaces(element)) tasks.push(ensureFace(spec.fontId, spec.weight, spec.italic));
  }
  return Promise.all(tasks);
}

export function faceCss(face: LoadedFace | null | undefined, weight: number, italic: boolean): { fontFamily: string; fontStyle: "normal" | "italic"; fontWeight: string } {
  if (!face) return { fontFamily: FALLBACK_STACK, fontStyle: italic ? "italic" : "normal", fontWeight: String(weight) };
  return { fontFamily: `"${face.family}", ${FALLBACK_STACK}`, fontStyle: italic && face.synthetic ? "italic" : "normal", fontWeight: "normal" };
}
