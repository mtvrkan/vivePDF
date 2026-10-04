import type { StudioListKind, StudioParagraph, StudioTextElement, StudioTextRun } from "@/types/studio";
import { MAX_RUN_SCALE, MIN_RUN_SCALE, normalizeWeight } from "../model/design";
import { DEFAULT_PARAGRAPH, DEFAULT_TEXT_FONT_ID, fitParagraphs, MAX_LIST_LEVEL, paragraphAt, paragraphCount } from "../model/typography";

export type RunStyle = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; fontId: string; scale: number; weight: number | null };
export type StylePatch = Partial<RunStyle>;
type ElementStyle = Pick<StudioTextElement, "bold" | "italic" | "underline" | "strike" | "color" | "fontId" | "weight">;

const STYLE_KEYS = ["bold", "italic", "underline", "strike", "color", "fontId", "scale", "weight"] as const;
const FLAG_KEYS = ["bold", "italic", "underline", "strike"] as const;
const COLOUR = /^#[0-9a-f]{6}$/i;
const LIST_KINDS = new Set<string>(["none", "bullet", "dash", "check", "decimal", "alpha", "roman"]);

export function runStyle(element: ElementStyle, run: StudioTextRun): RunStyle {
  return {
    bold: run.bold ?? element.bold,
    italic: run.italic ?? element.italic,
    underline: run.underline ?? element.underline,
    strike: run.strike ?? element.strike,
    color: run.color ?? element.color,
    fontId: run.fontId ?? element.fontId ?? DEFAULT_TEXT_FONT_ID,
    scale: run.scale ?? 1,
    weight: run.weight !== undefined ? run.weight : element.weight,
  };
}

function sameStyle(left: RunStyle, right: RunStyle): boolean {
  return STYLE_KEYS.every((key) => left[key] === right[key]);
}

function runOf(element: ElementStyle, text: string, style: RunStyle): StudioTextRun {
  const base = runStyle(element, { text: "" });
  const run: StudioTextRun = { text };
  for (const key of FLAG_KEYS) if (style[key] !== base[key]) run[key] = style[key];
  if (style.color !== base.color) run.color = style.color;
  if (style.fontId !== base.fontId) run.fontId = style.fontId;
  if (style.scale !== 1) run.scale = style.scale;
  if (style.weight !== base.weight) run.weight = style.weight;
  return run;
}

export function compactRuns(element: ElementStyle, runs: StudioTextRun[]): StudioTextRun[] {
  const merged: { text: string; style: RunStyle }[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const style = runStyle(element, run);
    const last = merged[merged.length - 1];
    if (last && sameStyle(last.style, style)) last.text += run.text;
    else merged.push({ text: run.text, style });
  }
  if (!merged.length) return [{ text: "" }];
  return merged.map(({ text, style }) => runOf(element, text, style));
}

function splitAt(runs: StudioTextRun[], offset: number): StudioTextRun[] {
  const result: StudioTextRun[] = [];
  let position = 0;
  for (const run of runs) {
    const end = position + run.text.length;
    if (offset > position && offset < end) {
      result.push({ ...run, text: run.text.slice(0, offset - position) }, { ...run, text: run.text.slice(offset - position) });
    } else {
      result.push(run);
    }
    position = end;
  }
  return result;
}

function selectedRuns(runs: StudioTextRun[], start: number, end: number, visit: (run: StudioTextRun, inside: boolean) => void) {
  let position = 0;
  for (const run of runs) {
    const runEnd = position + run.text.length;
    visit(run, run.text.length > 0 && position >= start && runEnd <= end);
    position = runEnd;
  }
}

function patchRun(element: ElementStyle, run: StudioTextRun, patch: StylePatch): StudioTextRun {
  return runOf(element, run.text, { ...runStyle(element, run), ...patch });
}

export function applyRunStyle(element: StudioTextElement, start: number, end: number, patch: StylePatch): StudioTextRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  if (from === to) return element.runs;
  const pieces = splitAt(splitAt(element.runs, from), to);
  const styled: StudioTextRun[] = [];
  selectedRuns(pieces, from, to, (run, inside) => {
    styled.push(inside ? patchRun(element, run, patch) : run);
  });
  return compactRuns(element, styled);
}

export function styleSummary(element: StudioTextElement, start: number, end: number): RunStyle {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const styles: RunStyle[] = [];
  selectedRuns(splitAt(splitAt(element.runs, from), to), from, to, (run, inside) => {
    if (inside && run.text.trim()) styles.push(runStyle(element, run));
  });
  if (!styles.length) return runStyle(element, { text: "" });
  return {
    ...styles[0],
    bold: styles.every((style) => style.bold),
    italic: styles.every((style) => style.italic),
    underline: styles.every((style) => style.underline),
    strike: styles.every((style) => style.strike),
  };
}

export function withElementStyle(element: StudioTextElement, patch: StylePatch): StudioTextElement {
  const next: StudioTextElement = { ...element };
  if (patch.bold !== undefined) next.bold = patch.bold;
  if (patch.italic !== undefined) next.italic = patch.italic;
  if (patch.underline !== undefined) next.underline = patch.underline;
  if (patch.strike !== undefined) next.strike = patch.strike;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.fontId !== undefined) next.fontId = patch.fontId;
  if ("weight" in patch) next.weight = patch.weight ?? null;
  const runs = element.runs.map((run) => {
    const copy = { ...run };
    for (const key of STYLE_KEYS) if (key in patch) delete copy[key];
    return copy;
  });
  return { ...next, runs: compactRuns(next, runs) };
}

export function weightPatch(weight: number): StylePatch {
  return { weight, bold: weight >= 600 };
}

export function boldPatch(bold: boolean): StylePatch {
  return { bold, weight: null };
}

export function paragraphIndexes(runs: StudioTextRun[], start: number, end: number): number[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const text = runs.map((run) => run.text).join("");
  const indexes: number[] = [];
  let paragraphStart = 0;
  let index = 0;
  const check = (paragraphEnd: number) => {
    if (from === to ? from >= paragraphStart && from <= paragraphEnd : from <= paragraphEnd && to > paragraphStart) indexes.push(index);
  };
  for (let position = 0; position < text.length; position += 1) {
    if (text[position] !== "\n") continue;
    check(position);
    index += 1;
    paragraphStart = position + 1;
  }
  check(text.length);
  return indexes;
}

export function updateParagraphs(element: StudioTextElement, indexes: number[] | null, change: (paragraph: StudioParagraph) => StudioParagraph): StudioParagraph[] {
  const count = paragraphCount(element.runs);
  const chosen = indexes ? new Set(indexes) : null;
  return Array.from({ length: count }, (_, index) => {
    const current = paragraphAt(element.paragraphs, index);
    return !chosen || chosen.has(index) ? change(current) : current;
  });
}

export function toggleList(paragraphs: StudioParagraph[], kind: StudioListKind): (paragraph: StudioParagraph) => StudioParagraph {
  const all = paragraphs.length > 0 && paragraphs.every((paragraph) => paragraph.list === kind);
  return (paragraph) => ({ list: all ? "none" : kind, level: all ? 0 : paragraph.level });
}

export function shiftLevel(delta: number): (paragraph: StudioParagraph) => StudioParagraph {
  return (paragraph) => (paragraph.list === "none" ? paragraph : { ...paragraph, level: Math.min(MAX_LIST_LEVEL, Math.max(0, paragraph.level + delta)) });
}

export function replaceRange(element: StudioTextElement, start: number, end: number, text: string): StudioTextRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const before: StudioTextRun[] = [];
  const after: StudioTextRun[] = [];
  let template: StudioTextRun | null = null;
  let position = 0;
  for (const run of splitAt(splitAt(element.runs, from), to)) {
    const runEnd = position + run.text.length;
    if (run.text.length && from !== to && position >= from && runEnd <= to) template ??= run;
    else if (runEnd <= from) before.push(run);
    else after.push(run);
    position = runEnd;
  }
  const style = template ?? before[before.length - 1] ?? after[0] ?? { text: "" };
  return compactRuns(element, [...before, ...(text ? [{ ...style, text }] : []), ...after]);
}

function flag(value: string | undefined): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function isBlock(node: Node): boolean {
  return node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
}

function isMarker(node: Node): boolean {
  return node instanceof HTMLElement && node.dataset.marker !== undefined;
}

export function blockParagraph(block: HTMLElement | null, fallback: StudioParagraph = DEFAULT_PARAGRAPH): StudioParagraph {
  if (!block || block.dataset.list === undefined) return fallback;
  const list = LIST_KINDS.has(block.dataset.list) ? (block.dataset.list as StudioListKind) : "none";
  const level = Math.min(MAX_LIST_LEVEL, Math.max(0, Math.round(Number(block.dataset.level) || 0)));
  return { list, level };
}

function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node.parentNode;
  while (current && current !== root) {
    if (isBlock(current)) return current as HTMLElement;
    current = current.parentNode;
  }
  return null;
}

function followsInBlock(node: Node, root: HTMLElement): boolean {
  const container = blockOf(node, root) ?? root;
  let current: Node | null = node;
  while (current && current !== container) {
    let sibling = current.nextSibling;
    while (sibling) {
      if (isBlock(sibling)) return false;
      if (!isMarker(sibling) && ((sibling.textContent ?? "").length > 0 || (sibling instanceof HTMLElement && (sibling.tagName === "BR" || sibling.querySelector("br"))))) return true;
      sibling = sibling.nextSibling;
    }
    current = current.parentNode;
  }
  return false;
}

type Entry = { kind: "text"; node: Text; start: number } | { kind: "break"; start: number; paragraph: StudioParagraph; before: { node: Node; offset: number }; after: { node: Node; offset: number } };

function flatten(root: HTMLElement): { entries: Entry[]; first: StudioParagraph; total: number } {
  const entries: Entry[] = [];
  let total = 0;
  let first: StudioParagraph | null = null;
  let started = false;
  let lastPoint: { node: Node; offset: number } = { node: root, offset: 0 };
  const openParagraph = (paragraph: StudioParagraph, after: { node: Node; offset: number }) => {
    if (!started) {
      started = true;
      first = paragraph;
      return;
    }
    entries.push({ kind: "break", start: total, paragraph, before: lastPoint, after });
    total += 1;
  };
  const walk = (node: Node, paragraph: StudioParagraph) => {
    node.childNodes.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child as Text;
        if (!started) openParagraph(paragraph, { node, offset: index });
        if (!text.data.length) return;
        entries.push({ kind: "text", node: text, start: total });
        total += text.data.length;
        lastPoint = { node: text, offset: text.data.length };
        return;
      }
      if (!(child instanceof HTMLElement) || isMarker(child)) return;
      if (isBlock(child)) {
        const own = blockParagraph(child as HTMLElement, paragraph);
        openParagraph(own, { node: child, offset: 0 });
        lastPoint = { node: child, offset: 0 };
        walk(child, own);
        return;
      }
      if (child.tagName === "BR") {
        if (!started) openParagraph(paragraph, { node, offset: index });
        if (!followsInBlock(child, root)) return;
        entries.push({ kind: "break", start: total, paragraph: blockParagraph(blockOf(child, root), paragraph), before: { node, offset: index }, after: { node, offset: index + 1 } });
        total += 1;
        lastPoint = { node, offset: index + 1 };
        return;
      }
      if (!started) openParagraph(paragraph, { node, offset: index });
      walk(child, paragraph);
    });
  };
  walk(root, DEFAULT_PARAGRAPH);
  return { entries, first: first ?? DEFAULT_PARAGRAPH, total };
}

function inherited(node: Node, root: HTMLElement): StudioTextRun {
  const style: StudioTextRun = { text: "" };
  let current: Node | null = node.parentNode;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      const data = current.dataset;
      if (style.bold === undefined) style.bold = flag(data.b);
      if (style.italic === undefined) style.italic = flag(data.i);
      if (style.underline === undefined) style.underline = flag(data.u);
      if (style.strike === undefined) style.strike = flag(data.s);
      if (style.color === undefined && data.c && COLOUR.test(data.c)) style.color = data.c.toLowerCase();
      if (style.fontId === undefined && data.f) style.fontId = data.f.slice(0, 1024);
      if (style.scale === undefined && data.z) {
        const scale = Number(data.z);
        if (Number.isFinite(scale)) style.scale = Math.min(MAX_RUN_SCALE, Math.max(MIN_RUN_SCALE, scale));
      }
      if (style.weight === undefined && data.w !== undefined) style.weight = data.w === "" ? null : normalizeWeight(Number(data.w));
    }
    current = current.parentNode;
  }
  return style;
}

export function textFromDom(root: HTMLElement, element: StudioTextElement): { runs: StudioTextRun[]; paragraphs: StudioParagraph[] } {
  const { entries, first } = flatten(root);
  const runs: StudioTextRun[] = [];
  const paragraphs: StudioParagraph[] = [first];
  for (const entry of entries) {
    if (entry.kind === "break") {
      runs.push({ text: "\n" });
      paragraphs.push(entry.paragraph);
      continue;
    }
    const text = entry.node.data.replace(/\u00a0/g, " ");
    const style = inherited(entry.node, root);
    const run: StudioTextRun = { text };
    for (const key of STYLE_KEYS) if (style[key] !== undefined) (run as Record<string, unknown>)[key] = style[key];
    runs.push(run);
  }
  const compacted = compactRuns(element, runs);
  return { runs: compacted, paragraphs: fitParagraphs(paragraphs, paragraphCount(compacted)) };
}

export function runsFromDom(root: HTMLElement, element: StudioTextElement): StudioTextRun[] {
  return textFromDom(root, element).runs;
}

export function textLength(root: HTMLElement): number {
  return flatten(root).total;
}

function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  const { entries, total } = flatten(root);
  const point = document.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  let position = 0;
  for (const entry of entries) {
    if (entry.kind === "text") {
      if (entry.node === container) return entry.start + Math.min(offset, entry.node.data.length);
      if (point.comparePoint(entry.node, entry.node.data.length) <= 0) position = entry.start + entry.node.data.length;
      else break;
      continue;
    }
    if (point.comparePoint(entry.after.node, entry.after.offset) <= 0) position = entry.start + 1;
    else break;
  }
  return Math.min(position, total);
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return { start: offsetOf(root, range.startContainer, range.startOffset), end: offsetOf(root, range.endContainer, range.endOffset) };
}

function pointAt(root: HTMLElement, target: number): { node: Node; offset: number } {
  const { entries } = flatten(root);
  let remaining = target;
  for (const entry of entries) {
    if (entry.kind === "text") {
      const length = entry.node.data.length;
      if (remaining <= length) return { node: entry.node, offset: remaining };
      remaining -= length;
      continue;
    }
    if (remaining === 0) return entry.before;
    remaining -= 1;
    if (remaining === 0) return entry.after;
  }
  const blocks = Array.from(root.children).filter(isBlock);
  const last = blocks[blocks.length - 1];
  if (remaining === 0 && last && !last.textContent) return { node: last, offset: 0 };
  return { node: root, offset: root.childNodes.length };
}

export function restoreSelection(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const from = pointAt(root, start);
  const to = pointAt(root, end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}
