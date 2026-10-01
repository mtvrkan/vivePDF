import type { EditorRun, EditorTextLine } from "@/types";
import type { BlockRun as Run, RunStyle } from "@/shared/store/viewerOverlayStore";

export type { BlockRun as Run, RunStyle } from "@/shared/store/viewerOverlayStore";

export function textOf(runs: Run[]): string {
  return runs.map((run) => run.text).join("");
}

export function toEditorRun(run: Run): EditorRun {
  return { text: run.text, font: run.font ?? undefined, fontXref: run.fontXref || undefined, size: run.size, color: run.color, bold: run.bold, italic: run.italic, superscript: run.superscript };
}

export function sameRuns(left: Run[], right: Run[]): boolean {
  const normalize = (runs: Run[]) => JSON.stringify(mergeRuns(runs.map((run) => ({ ...run }))).map((run) => [run.text, runStyleAttr(styleOf(run))]));
  return normalize(left) === normalize(right);
}

export function hasMixedStyles(runs: Run[]): boolean {
  const styles = new Set(runs.filter((run) => run.text.trim().length > 0).map((run) => runStyleAttr(styleOf(run))));
  return styles.size > 1;
}

export function restoreOriginalRunStyles(runs: Run[], originalRuns: Run[], fallback: RunStyle): Run[] {
  if (originalRuns.length === 0) return runs;
  return applyTextEdit(originalRuns.map((run) => ({ ...run })), textOf(runs), fallback);
}

export function applyStyleToRuns(runs: Run[], patch: Record<string, unknown>): Run[] {
  const runPatch: Partial<RunStyle> = {};
  if ("fontSize" in patch) runPatch.size = patch.fontSize as number;
  if ("color" in patch) runPatch.color = patch.color as string;
  if ("bold" in patch) runPatch.bold = patch.bold as boolean;
  if ("italic" in patch) runPatch.italic = patch.italic as boolean;
  if ("font" in patch) runPatch.font = patch.font as string | null;
  if (Object.keys(runPatch).length === 0) return runs;
  return mergeRuns(runs.map((run) => ({ ...run, ...runPatch })));
}

function trimRunEdges(runs: Run[]): Run[] {
  const copy = runs.map((run) => ({ ...run }));
  if (copy.length > 0) copy[0].text = copy[0].text.replace(/^\s+/, "");
  if (copy.length > 0) copy[copy.length - 1].text = copy[copy.length - 1].text.replace(/\s+$/, "");
  return copy.filter((run) => run.text.length > 0);
}

export function flattenLines(lines: EditorTextLine[]): Run[] {
  const runs: Run[] = [];
  lines.forEach((line, index) => {
    const lineRuns = trimRunEdges(
      line.runs.map((run) => ({ text: run.text, font: run.font, fontXref: run.fontXref, size: run.size, color: run.color, bold: run.bold, italic: run.italic, superscript: run.superscript })),
    );
    if (lineRuns.length === 0) return;
    const previous = runs[runs.length - 1];
    if (previous) {
      const hard = lines[index - 1]?.hardBreak ?? false;
      if (hard) runs.push({ ...previous, text: "\n" });
      else if (previous.text.endsWith("-") && /^[a-zçğıöşü]/.test(lineRuns[0].text)) previous.text = previous.text.slice(0, -1);
      else runs.push({ ...previous, text: " " });
    }
    runs.push(...lineRuns);
  });
  return mergeRuns(runs);
}

function sameStyle(a: Run, b: Run): boolean {
  return a.font === b.font && a.fontXref === b.fontXref && a.size === b.size && a.color === b.color && a.bold === b.bold && a.italic === b.italic && a.superscript === b.superscript;
}

export function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const result: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    const sliceStart = Math.max(start, runStart);
    const sliceEnd = Math.min(end, runEnd);
    if (sliceStart >= sliceEnd) continue;
    result.push({ ...run, text: run.text.slice(sliceStart - runStart, sliceEnd - runStart) });
  }
  return result;
}

export function styleOf(run: Run): RunStyle {
  return { font: run.font, fontXref: run.fontXref, size: run.size, color: run.color, bold: run.bold, italic: run.italic, superscript: run.superscript };
}

export function charStyleAt(runs: Run[], charIndex: number): RunStyle | null {
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (charIndex >= pos && charIndex < end) return styleOf(run);
    pos = end;
  }
  return null;
}

function styleForInsertion(runs: Run[], prefix: number, fallback: RunStyle): RunStyle {
  if (prefix > 0) {
    const before = charStyleAt(runs, prefix - 1);
    if (before) return before;
  }
  const after = charStyleAt(runs, prefix);
  if (after) return after;
  if (runs.length > 0) return styleOf(runs[runs.length - 1]);
  return fallback;
}

export function applyTextEdit(runs: Run[], nextText: string, fallback: RunStyle): Run[] {
  const oldText = textOf(runs);
  if (oldText === nextText) return runs;
  const maxPrefix = Math.min(oldText.length, nextText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText[prefix] === nextText[prefix]) prefix += 1;
  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix += 1;
  const oldMiddleEnd = oldText.length - suffix;
  const newMiddleText = nextText.slice(prefix, nextText.length - suffix);
  const prefixRuns = sliceRuns(runs, 0, prefix);
  const suffixRuns = sliceRuns(runs, oldMiddleEnd, oldText.length);
  const middleRuns: Run[] = newMiddleText ? [{ ...styleForInsertion(runs, prefix, fallback), text: newMiddleText }] : [];
  return mergeRuns([...prefixRuns, ...middleRuns, ...suffixRuns]);
}

export function setStyleRange(runs: Run[], start: number, end: number, patch: Partial<RunStyle>): Run[] {
  const length = textOf(runs).length;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(length, Math.max(start, end));
  if (from >= to) return runs;
  const before = sliceRuns(runs, 0, from);
  const middle = sliceRuns(runs, from, to).map((run) => ({ ...run, ...patch }));
  const after = sliceRuns(runs, to, length);
  return mergeRuns([...before, ...middle, ...after]);
}

export function rangeIsBold(runs: Run[], start: number, end: number): boolean {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(textOf(runs).length, Math.max(start, end));
  if (from >= to) return false;
  return sliceRuns(runs, from, to).every((run) => run.bold);
}

export function rangeIsItalic(runs: Run[], start: number, end: number): boolean {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(textOf(runs).length, Math.max(start, end));
  if (from >= to) return false;
  return sliceRuns(runs, from, to).every((run) => run.italic);
}

export function runsFromDom(root: Node, fallback: RunStyle): Run[] {
  const runs: Run[] = [];
  let current: RunStyle = fallback;
  const readStyle = (element: HTMLElement): RunStyle | null => {
    const raw = element.dataset.runStyle;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RunStyle;
    } catch {
      return null;
    }
  };
  const walk = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) runs.push({ ...current, text });
      return;
    }
    if (node.nodeName === "BR") {
      runs.push({ ...current, text: "\n" });
      return;
    }
    if (node instanceof HTMLElement) {
      const style = readStyle(node);
      if (style) current = style;
      node.childNodes.forEach(walk);
    }
  };
  root.childNodes.forEach(walk);
  return mergeRuns(runs);
}

export function runStyleAttr(style: RunStyle): string {
  return JSON.stringify(style);
}
