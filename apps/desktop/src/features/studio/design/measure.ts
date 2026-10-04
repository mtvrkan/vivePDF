import type { StudioElement, StudioRenderSegment, StudioTextElement } from "@/types/studio";
import { hasPlaceholders, textOf } from "../model/design";
import { ensureElementFonts, useStudioFontsStore } from "./fonts";
import { runStyle } from "./richText";
import { runsHtml, textBodyStyle, textFrameStyle } from "./textStyle";

export const MIN_FIT_SIZE = 4;
export const FIT_STEP = 0.5;
const SAME_LINE = 0.5;
const TOUCHING = 0.75;
const DOTLESS = new Set(["tr", "az"]);

export function upperText(text: string, language: string): string {
  const prefix = language.split("-")[0].toLowerCase();
  return (DOTLESS.has(prefix) ? text.replace(/i/g, "İ") : text).toUpperCase();
}

function applyStyle(node: HTMLElement, style: object) {
  Object.assign(node.style, style);
}

export function fitTextSize(body: HTMLElement, element: StudioTextElement): number {
  if (!element.shrinkToFit) return element.fontSize;
  const wrap = body.style.overflowWrap;
  body.style.overflowWrap = "normal";
  const floor = Math.min(MIN_FIT_SIZE, element.fontSize);
  const sizeAt = (step: number) => Math.max(floor, element.fontSize - step * FIT_STEP);
  const fits = (step: number) => {
    body.style.fontSize = `${sizeAt(step)}px`;
    return body.offsetHeight <= element.height + 0.01 && body.scrollWidth <= Math.ceil(element.width) + 0.5;
  };
  let low = 0;
  let high = Math.max(0, Math.ceil((element.fontSize - MIN_FIT_SIZE) / FIT_STEP));
  if (!fits(low) && high > 0) {
    low = 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (fits(middle)) high = middle;
      else low = middle + 1;
    }
  }
  const size = sizeAt(low);
  body.style.overflowWrap = wrap;
  body.style.fontSize = `${size}px`;
  return size;
}

const ascents = new Map<string, number>();

function ascentOf(span: HTMLElement, size: number): number {
  const key = `${span.style.fontFamily}|${span.style.fontStyle}|${size}`;
  const known = ascents.get(key);
  if (known !== undefined) return known;
  const probe = document.createElement("span");
  probe.style.cssText = span.style.cssText;
  probe.style.fontSize = `${size}px`;
  probe.style.lineHeight = "normal";
  probe.textContent = "H";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  probe.append(marker);
  span.ownerDocument.body.append(probe);
  const range = document.createRange();
  range.setStart(probe.firstChild as Text, 0);
  range.setEnd(probe.firstChild as Text, 1);
  const ascent = marker.getBoundingClientRect().bottom - range.getBoundingClientRect().top;
  probe.remove();
  ascents.set(key, ascent);
  return ascent;
}

type Open = { segment: StudioRenderSegment; right: number; top: number; run: number };

export function segmentsOf(frame: HTMLElement, element: StudioTextElement, size: number, language: string): StudioRenderSegment[] {
  const origin = frame.getBoundingClientRect();
  const segments: StudioRenderSegment[] = [];
  let open: Open | null = null;
  const close = () => {
    if (open) segments.push(open.segment);
    open = null;
  };
  const spans = Array.from(frame.querySelectorAll<HTMLElement>("span[data-b]"));
  spans.forEach((span, runIndex) => {
    const node = span.firstChild;
    const run = element.runs[runIndex];
    if (!(node instanceof Text) || !run) return;
    const style = runStyle(element, run);
    const ascent = ascentOf(span, size);
    const text = node.data;
    const range = document.createRange();
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (/\s/.test(char)) {
        close();
        continue;
      }
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const current = open as Open | null;
      if (current && current.run === runIndex && Math.abs(rect.top - current.top) < SAME_LINE && Math.abs(rect.left - current.right) < TOUCHING) {
        current.segment.text += char;
        current.right = rect.right;
        continue;
      }
      close();
      open = {
        run: runIndex,
        top: rect.top,
        right: rect.right,
        segment: {
          text: char,
          x: rect.left - origin.left,
          y: rect.top - origin.top + ascent,
          size,
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          color: style.color,
          letterSpacing: element.letterSpacing * size,
        },
      };
    }
    close();
  });
  close();
  if (element.uppercase) for (const segment of segments) segment.text = upperText(segment.text, language);
  return segments;
}

export function buildTextNode(element: StudioTextElement, language: string): { frame: HTMLDivElement; body: HTMLDivElement } {
  const frame = document.createElement("div");
  frame.lang = language;
  applyStyle(frame, { ...textFrameStyle(element), width: `${element.width}px`, height: `${element.height}px` });
  const body = document.createElement("div");
  applyStyle(body, textBodyStyle(element, element.fontSize));
  body.innerHTML = runsHtml(element, useStudioFontsStore.getState().faces);
  frame.append(body);
  return { frame, body };
}

export async function measureTexts(elements: StudioElement[], language: string): Promise<Map<string, StudioRenderSegment[]>> {
  const texts = elements.filter((element): element is StudioTextElement => element.kind === "text" && !element.hidden && textOf(element.runs).trim() !== "" && !hasPlaceholders(textOf(element.runs)));
  const measured = new Map<string, StudioRenderSegment[]>();
  if (!texts.length) return measured;
  await ensureElementFonts(texts);
  await document.fonts.ready;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style";
  document.body.append(host);
  try {
    for (const element of texts) {
      const { frame, body } = buildTextNode(element, language);
      host.append(frame);
      const size = fitTextSize(body, element);
      measured.set(element.id, segmentsOf(frame, element, size, language));
      frame.remove();
    }
  } finally {
    host.remove();
  }
  return measured;
}
