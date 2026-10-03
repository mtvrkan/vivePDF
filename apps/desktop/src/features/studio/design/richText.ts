import type { StudioTextElement, StudioTextRun } from "@/types/studio";

export type RunStyle = { bold: boolean; italic: boolean; underline: boolean; color: string };
export type StylePatch = Partial<RunStyle>;
const STYLE_KEYS = ["bold", "italic", "underline", "color"] as const;
const COLOUR = /^#[0-9a-f]{6}$/i;

export function runStyle(element: Pick<StudioTextElement, "bold" | "italic" | "underline" | "color">, run: StudioTextRun): RunStyle {
  return { bold: run.bold ?? element.bold, italic: run.italic ?? element.italic, underline: run.underline ?? element.underline, color: run.color ?? element.color };
}

function sameStyle(left: RunStyle, right: RunStyle): boolean {
  return STYLE_KEYS.every((key) => left[key] === right[key]);
}

export function compactRuns(element: Pick<StudioTextElement, "bold" | "italic" | "underline" | "color">, runs: StudioTextRun[]): StudioTextRun[] {
  const merged: { text: string; style: RunStyle }[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const style = runStyle(element, run);
    const last = merged[merged.length - 1];
    if (last && sameStyle(last.style, style)) last.text += run.text;
    else merged.push({ text: run.text, style });
  }
  if (!merged.length) return [{ text: "" }];
  return merged.map(({ text, style }) => {
    const run: StudioTextRun = { text };
    if (style.bold !== element.bold) run.bold = style.bold;
    if (style.italic !== element.italic) run.italic = style.italic;
    if (style.underline !== element.underline) run.underline = style.underline;
    if (style.color !== element.color) run.color = style.color;
    return run;
  });
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

export function applyRunStyle(element: StudioTextElement, start: number, end: number, patch: StylePatch): StudioTextRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  if (from === to) return element.runs;
  const pieces = splitAt(splitAt(element.runs, from), to);
  const styled: StudioTextRun[] = [];
  selectedRuns(pieces, from, to, (run, inside) => {
    styled.push(inside ? { ...run, ...patch } : run);
  });
  return compactRuns(element, styled);
}

export function styleSummary(element: StudioTextElement, start: number, end: number): RunStyle {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const styles: RunStyle[] = [];
  selectedRuns(splitAt(splitAt(element.runs, from), to), from, to, (run, inside) => {
    if (inside) styles.push(runStyle(element, run));
  });
  if (!styles.length) return runStyle(element, { text: "" });
  return {
    bold: styles.every((style) => style.bold),
    italic: styles.every((style) => style.italic),
    underline: styles.every((style) => style.underline),
    color: styles[0].color,
  };
}

export function withElementStyle(element: StudioTextElement, patch: StylePatch): StudioTextElement {
  const next = { ...element, ...patch };
  const runs = element.runs.map((run) => {
    const copy = { ...run };
    for (const key of STYLE_KEYS) if (key in patch) delete copy[key];
    return copy;
  });
  return { ...next, runs: compactRuns(next, runs) };
}

function flag(value: string | undefined): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

export function runsFromDom(root: HTMLElement, element: StudioTextElement): StudioTextRun[] {
  const runs: StudioTextRun[] = [];
  const inherited = (node: Node): StudioTextRun => {
    const style: StudioTextRun = { text: "" };
    let current: Node | null = node.parentNode;
    while (current && current !== root) {
      if (current instanceof HTMLElement) {
        const data = current.dataset;
        if (style.bold === undefined) style.bold = flag(data.b);
        if (style.italic === undefined) style.italic = flag(data.i);
        if (style.underline === undefined) style.underline = flag(data.u);
        if (style.color === undefined && data.c && COLOUR.test(data.c)) style.color = data.c.toLowerCase();
      }
      current = current.parentNode;
    }
    return style;
  };
  const walk = (node: Node) => {
    node.childNodes.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/\u00a0/g, " ");
        if (text) runs.push({ ...inherited(child), text });
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (child.tagName === "BR") {
        const last = index === node.childNodes.length - 1 && node === root;
        if (!last) runs.push({ ...inherited(child), text: "\n" });
        return;
      }
      const block = child.tagName === "DIV" || child.tagName === "P";
      if (block && runs.length && !runs[runs.length - 1].text.endsWith("\n")) runs.push({ text: "\n" });
      walk(child);
    });
  };
  walk(root);
  const cleaned = runs.map((run) => {
    const copy: StudioTextRun = { text: run.text };
    if (run.bold !== undefined) copy.bold = run.bold;
    if (run.italic !== undefined) copy.italic = run.italic;
    if (run.underline !== undefined) copy.underline = run.underline;
    if (run.color !== undefined) copy.color = run.color;
    return copy;
  });
  return compactRuns(element, cleaned);
}

function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length;
  if (node instanceof HTMLElement && node.tagName === "BR") return 1;
  let total = 0;
  node.childNodes.forEach((child) => {
    total += textLength(child);
  });
  return total;
}

function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  let total = 0;
  let found = -1;
  const walk = (node: Node): boolean => {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) found = total + offset;
      else {
        let inner = total;
        for (let index = 0; index < offset && index < node.childNodes.length; index += 1) inner += textLength(node.childNodes[index]);
        found = inner;
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && node.tagName === "BR")) {
      total += textLength(node);
      return false;
    }
    for (const child of Array.from(node.childNodes)) if (walk(child)) return true;
    return false;
  };
  walk(root);
  return found < 0 ? textLength(root) : found;
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return { start: offsetOf(root, range.startContainer, range.startOffset), end: offsetOf(root, range.endContainer, range.endOffset) };
}

function pointAt(root: HTMLElement, target: number): { node: Node; offset: number } {
  let remaining = target;
  let result: { node: Node; offset: number } | null = null;
  const walk = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const length = (child.textContent ?? "").length;
        if (remaining <= length) {
          result = { node: child, offset: remaining };
          return true;
        }
        remaining -= length;
      } else if (child instanceof HTMLElement && child.tagName === "BR") {
        if (remaining === 0) {
          result = { node, offset: Array.from(node.childNodes).indexOf(child) };
          return true;
        }
        remaining -= 1;
      } else if (walk(child)) return true;
    }
    return false;
  };
  walk(root);
  return result ?? { node: root, offset: root.childNodes.length };
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
