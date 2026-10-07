import type { CSSProperties } from "react";
import type { BlockRun, EditorPending } from "@/shared/store/viewerOverlayStore";
import { restoreOriginalRunStyles, sameRuns, styleOf } from "./runs";

type BlockPending = Extract<EditorPending, { kind: "block" }>;
type ImageChangePending = Extract<EditorPending, { kind: "imageChange" }>;

export function keepsEditsOnLeave(objects: EditorPending[], documentStillOpen: boolean): boolean {
  return documentStillOpen && objects.some(isPendingChange);
}

export function isPendingChange(item: EditorPending): boolean {
  if (item.kind === "image") return true;
  if (item.kind === "edit") return item.text !== item.original;
  if (item.kind === "block") return item.text !== item.original || !styleUnchanged(item) || rectChanged(item);
  if (item.kind === "imageChange") return item.deleted || rectChanged(item) || item.replacement !== null || item.rotate !== 0 || item.flipH || item.flipV;
  return item.text.trim().length > 0;
}

export function rectChanged(item: BlockPending | ImageChangePending): boolean {
  const original = item.kind === "block" ? item.originalRect : item.original;
  return item.x !== original.x || item.y !== original.y || item.width !== original.width || item.height !== original.height;
}

export function styleUnchanged(item: BlockPending): boolean {
  if (JSON.stringify(item.style) !== JSON.stringify(item.originalStyle)) return false;
  if (item.originalRuns.length === 0) return true;
  const restored = restoreOriginalRunStyles(item.runs, item.originalRuns, styleOf(item.originalRuns[0]));
  return sameRuns(item.runs, restored);
}

export function isLatin1(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) > 255) return false;
  return true;
}

export function camelSplit(name: string): string {
  return name.includes(" ") ? name : name.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
}

function generic(font: string | null, text: string): string[] {
  const name = (font ?? "").toLowerCase();
  if (!isLatin1(text)) return ["DejaVu Sans", "Segoe UI", "sans-serif"];
  if (name.includes("courier") || name.includes("mono") || name.includes("consolas")) return ["Courier New", "Courier", "monospace"];
  if (name.includes("times")) return ["Times New Roman", "Times", "serif"];
  if (name.includes("helvetica") || name.includes("arial")) return ["Arial", "Helvetica", "sans-serif"];
  return ["DejaVu Sans", "Segoe UI", "sans-serif"];
}

export function fontStackFor(font: string | null, family: string, embedded: string | null, text: string): string {
  const stack: string[] = [];
  if (embedded) stack.push(embedded);
  if (family) {
    stack.push(family);
    const split = camelSplit(family);
    if (split !== family) stack.push(split);
  }
  stack.push(...generic(font, text));
  return stack.map((entry) => (/^[a-z-]+$/.test(entry) && !entry.startsWith("vp-") ? entry : `"${entry}"`)).join(", ");
}

export function fontFamilyFor(font: string | null): string {
  return fontStackFor(font, "", null, "a");
}

export function familyOfFontName(font: string | null): string {
  if (!font) return "";
  const withoutSubset = font.replace(/^[A-Z]{6}\+/, "");
  return withoutSubset.split(/[-,]/)[0].trim();
}

export function fontStackForRun(runFont: string | null, runFontXref: number, blockFontXref: number, blockFontFamily: string, fontFamilies: Record<string, string>, documentId: string, text: string): string {
  const isDominantFont = runFontXref !== 0 && runFontXref === blockFontXref;
  const original = isDominantFont ? blockFontFamily : familyOfFontName(runFont);
  const embedded = runFontXref !== 0 ? (fontFamilies[`${documentId}:${runFontXref}`] ?? null) : null;
  return fontStackFor(runFont, original, embedded, text);
}

export function runCss(run: BlockRun, fontFamily: string, sizePx: number): CSSProperties {
  return {
    fontFamily,
    fontSize: `${sizePx}px`,
    color: run.color,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    verticalAlign: run.superscript ? "super" : "baseline",
  };
}

export function fontFamilyChoice(font: string | null, original: string | null): "auto" | "sans" | "serif" | "mono" {
  if (font === original) return "auto";
  const name = (font ?? "").toLowerCase();
  if (name.startsWith("courier")) return "mono";
  if (name.startsWith("times")) return "serif";
  return "sans";
}

export function fontNameForChoice(choice: "auto" | "sans" | "serif" | "mono", original: string | null): string | null {
  if (choice === "auto") return original;
  if (choice === "serif") return "Times-Roman";
  if (choice === "mono") return "Courier";
  return "Helvetica";
}
