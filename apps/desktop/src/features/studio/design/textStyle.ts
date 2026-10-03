import type { CSSProperties } from "react";
import type { StudioTextElement, StudioTextRun } from "@/types/studio";
import { faceCss, faceKey, type LoadedFace } from "./fonts";
import { runStyle } from "./richText";

export const TEXT_FEATURES = '"kern" 0, "liga" 0, "clig" 0, "calt" 0';
const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export function textFrameStyle(element: StudioTextElement): CSSProperties {
  return { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: JUSTIFY[element.verticalAlign] };
}

export function textBodyStyle(element: StudioTextElement, fontSize: number): CSSProperties {
  return {
    margin: 0,
    width: "100%",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "normal",
    fontKerning: "none",
    fontVariantLigatures: "none",
    fontFeatureSettings: TEXT_FEATURES,
    fontSynthesis: "style",
    fontSize: `${fontSize}px`,
    lineHeight: String(element.lineHeight),
    letterSpacing: `${element.letterSpacing}em`,
    textAlign: element.align,
    textTransform: element.uppercase ? "uppercase" : "none",
    color: element.color,
    outline: "none",
    cursor: "inherit",
  };
}

export function runCss(element: StudioTextElement, run: StudioTextRun, faces: Record<string, LoadedFace | null>): CSSProperties {
  const style = runStyle(element, run);
  return {
    ...faceCss(faces[faceKey(element.fontId, style.bold, style.italic)], style.bold, style.italic),
    color: style.color,
    textDecorationLine: style.underline ? "underline" : "none",
    textDecorationSkipInk: "none",
    textUnderlinePosition: "from-font",
  };
}

export function runData(element: StudioTextElement, run: StudioTextRun): Record<string, string> {
  const style = runStyle(element, run);
  return { "data-b": style.bold ? "1" : "0", "data-i": style.italic ? "1" : "0", "data-u": style.underline ? "1" : "0", "data-c": style.color };
}

function cssText(style: CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${String(value)}`)
    .join(";");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function runsHtml(element: StudioTextElement, faces: Record<string, LoadedFace | null>): string {
  return element.runs
    .map((run) => {
      const data = Object.entries(runData(element, run))
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(" ");
      return `<span ${data} style="${escapeHtml(cssText(runCss(element, run, faces)))}">${escapeHtml(run.text)}</span>`;
    })
    .join("");
}
