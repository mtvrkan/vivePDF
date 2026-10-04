import type { CSSProperties } from "react";
import type { StudioParagraph, StudioTextElement } from "@/types/studio";
import { caseTexts, LIST_INDENT_EM, splitParagraphs, visibleParagraphs, weightOf } from "../model/typography";
import { faceCss, faceKey, markerFace, type LoadedFace } from "./fonts";
import { runStyle, type RunStyle } from "./richText";

export const TEXT_FEATURES = '"kern" 0, "liga" 0, "clig" 0, "calt" 0';
const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;
const EDITOR_CASE = { none: "none", upper: "uppercase", lower: "lowercase", title: "capitalize" } as const;
const MARKER_RULE_ID = "vp-studio-marker-rule";
const MARKER_RULE = `[data-vp-marker]::before{content:attr(data-vp-marker);display:inline-block;width:${LIST_INDENT_EM}em;margin-inline-start:-${LIST_INDENT_EM}em;text-align:start;text-decoration:none;text-transform:none;text-indent:0;font-size:1em;font-family:var(--vp-marker-family);font-style:normal;font-weight:var(--vp-marker-weight);color:var(--vp-marker-color);user-select:none}`;

type Faces = Record<string, LoadedFace | null>;
export type TextSpanView = { text: string; style: RunStyle };
export type TextBlockView = { paragraph: StudioParagraph; marker: TextSpanView | null; spans: TextSpanView[] };

export function textFrameStyle(element: StudioTextElement): CSSProperties {
  return { position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: JUSTIFY[element.verticalAlign] };
}

function rgba(colour: string, opacity: number): string {
  const channels = [1, 3, 5].map((index) => parseInt(colour.slice(index, index + 2), 16));
  return `rgba(${channels.join(", ")}, ${opacity})`;
}

export function textEffectsStyle(element: StudioTextElement): CSSProperties {
  const style: CSSProperties = {};
  if (element.outline) {
    style.WebkitTextStroke = `${element.outline.width * 2}px ${element.outline.color}`;
    style.paintOrder = "stroke fill";
  }
  if (element.shadow) style.textShadow = `${element.shadow.x}px ${element.shadow.y}px 0 ${rgba(element.shadow.color, element.shadow.opacity)}`;
  return style;
}

export function textBodyStyle(element: StudioTextElement, fontSize: number): CSSProperties {
  const sideways = element.autoSize === "width";
  return {
    position: "relative",
    margin: 0,
    width: sideways ? "max-content" : "100%",
    minWidth: sideways ? "100%" : undefined,
    whiteSpace: sideways ? "pre" : "pre-wrap",
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
    textTransform: "none",
    color: element.color,
    outline: "none",
    cursor: "inherit",
    ...textEffectsStyle(element),
  };
}

export function editorCaseStyle(element: StudioTextElement): CSSProperties {
  return { textTransform: EDITOR_CASE[element.textCase] };
}

function decoration(style: RunStyle): string {
  const lines = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(Boolean);
  return lines.length ? lines.join(" ") : "none";
}

export function runCss(style: RunStyle, faces: Faces): CSSProperties {
  const weight = weightOf(style.bold, style.weight);
  return {
    ...faceCss(faces[faceKey(style.fontId, weight, style.italic)], weight, style.italic),
    color: style.color,
    fontSize: style.scale !== 1 ? `${style.scale}em` : undefined,
    textDecorationLine: decoration(style),
    textDecorationSkipInk: "none",
    textUnderlinePosition: "from-font",
  };
}

export function runData(style: RunStyle): Record<string, string> {
  return {
    "data-b": style.bold ? "1" : "0",
    "data-i": style.italic ? "1" : "0",
    "data-u": style.underline ? "1" : "0",
    "data-s": style.strike ? "1" : "0",
    "data-c": style.color,
    "data-f": style.fontId,
    "data-z": String(style.scale),
    "data-w": style.weight === null ? "" : String(style.weight),
  };
}

export function paragraphCss(paragraph: StudioParagraph): CSSProperties {
  return paragraph.list === "none" ? {} : { paddingInlineStart: `${(paragraph.level + 1) * LIST_INDENT_EM}em` };
}

export function paragraphData(paragraph: StudioParagraph): Record<string, string> {
  return { "data-para": "", "data-list": paragraph.list, "data-level": String(paragraph.level) };
}

export function markerCss(style: RunStyle, faces: Faces): CSSProperties {
  const weight = weightOf(style.bold, style.weight);
  return {
    ...faceCss(faces[faceKey(style.fontId, weight, false)], weight, false),
    color: style.color,
    display: "inline-block",
    width: `${LIST_INDENT_EM}em`,
    marginInlineStart: `-${LIST_INDENT_EM}em`,
    textAlign: "start",
    textDecorationLine: "none",
    textTransform: "none",
    textIndent: "0",
  };
}

function markerVars(style: RunStyle, faces: Faces): CSSProperties {
  const css = markerCss(style, faces);
  return { "--vp-marker-family": css.fontFamily, "--vp-marker-weight": css.fontWeight, "--vp-marker-color": style.color } as CSSProperties;
}

export function textBlocks(element: StudioTextElement, options: { language: string; fill?: (text: string) => string; editing?: boolean }): TextBlockView[] {
  const split = splitParagraphs(element.runs, element.paragraphs, options.fill);
  const list = options.editing ? split : visibleParagraphs(split);
  const cased = options.editing ? null : caseTexts(list.flatMap((entry) => [...entry.runs.map((run) => run.text), "\n"]), element.textCase, options.language);
  let cursor = 0;
  return list.map((entry) => {
    const spans = entry.runs.map((run) => ({ text: cased ? cased[cursor++] : run.text, style: runStyle(element, run) }));
    if (cased) cursor += 1;
    const first = runStyle(element, entry.runs[0] ?? { text: "" });
    const face = markerFace(entry.paragraph.list, { fontId: first.fontId, weight: weightOf(first.bold, first.weight) });
    const marker = entry.marker
      ? { text: entry.marker, style: { ...first, fontId: face.fontId, weight: face.weight, bold: face.weight >= 600, italic: false, underline: false, strike: false, scale: 1 } }
      : null;
    return { paragraph: entry.paragraph, marker, spans };
  });
}

export function applyCss(node: HTMLElement, style: CSSProperties) {
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null || value === "") continue;
    node.style.setProperty(key.startsWith("--") ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), String(value));
  }
}

function setData(node: HTMLElement, data: Record<string, string>) {
  for (const [key, value] of Object.entries(data)) node.setAttribute(key, value);
}

export function ensureMarkerRule() {
  if (document.getElementById(MARKER_RULE_ID)) return;
  const style = document.createElement("style");
  style.id = MARKER_RULE_ID;
  style.textContent = MARKER_RULE;
  document.head.append(style);
}

export function blockNodes(blocks: TextBlockView[], faces: Faces, editing: boolean): HTMLElement[] {
  return blocks.map((block) => {
    const div = document.createElement("div");
    setData(div, paragraphData(block.paragraph));
    applyCss(div, paragraphCss(block.paragraph));
    if (block.marker && editing) {
      div.setAttribute("data-vp-marker", block.marker.text);
      applyCss(div, markerVars(block.marker.style, faces));
    } else if (block.marker) {
      const marker = document.createElement("span");
      setData(marker, { ...runData(block.marker.style), "data-marker": "" });
      applyCss(marker, markerCss(block.marker.style, faces));
      marker.textContent = block.marker.text;
      div.append(marker);
    }
    for (const span of block.spans) {
      const node = document.createElement("span");
      setData(node, { ...runData(span.style), "data-run": "" });
      applyCss(node, runCss(span.style, faces));
      node.textContent = span.text;
      div.append(node);
    }
    if (!block.spans.length) div.append(document.createElement("br"));
    return div;
  });
}

export function blocksSignature(blocks: TextBlockView[], faces: Faces): string {
  return JSON.stringify([blocks, blocks.flatMap((block) => [block.marker, ...block.spans]).map((span) => (span ? runCss(span.style, faces).fontFamily : ""))]);
}
