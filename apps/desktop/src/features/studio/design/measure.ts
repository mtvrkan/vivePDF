import type { StudioElement, StudioMeasuredText, StudioRenderBand, StudioRenderSegment, StudioTextElement } from "@/types/studio";
import { hasPlaceholders, MIN_ELEMENT_SIDE, textDirection, textOf } from "../model/design";
import { BOLD_WEIGHT, REGULAR_WEIGHT } from "../model/typography";
import { ensureElementFonts, useStudioFontsStore } from "./fonts";
import { applyCss, blockNodes, textBlocks, textBodyStyle, textFrameStyle } from "./textStyle";

export const MIN_FIT_SIZE = 4;
export const FIT_STEP = 0.5;
const SAME_LINE = 0.5;
const TOUCHING = 0.75;
const FIT_TOLERANCE = 0.25;
const ANCHOR = { left: 0, center: 0.5, right: 1, justify: 0 } as const;

export function fitTextSize(body: HTMLElement, element: StudioTextElement): number {
  if (element.autoSize !== "shrink") return element.fontSize;
  const wrap = body.style.overflowWrap;
  const floor = Math.min(MIN_FIT_SIZE, element.fontSize);
  const sizeAt = (step: number) => Math.max(floor, element.fontSize - step * FIT_STEP);
  const fits = (step: number) => {
    body.style.fontSize = `${sizeAt(step)}px`;
    body.style.overflowWrap = "normal";
    const narrow = body.scrollWidth <= Math.ceil(element.width) + 0.5;
    body.style.overflowWrap = wrap;
    return narrow && body.offsetHeight <= element.height + 0.01;
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
  body.style.fontSize = `${size}px`;
  return size;
}

const ascents = new Map<string, number>();

function ascentOf(span: HTMLElement, size: number): number {
  const key = `${span.style.fontFamily}|${span.style.fontStyle}|${span.style.fontWeight}|${size}`;
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

function spanSize(span: HTMLElement, fallback: number): number {
  const size = parseFloat(getComputedStyle(span).fontSize);
  return Number.isFinite(size) && size > 0 ? size : fallback;
}

type Open = { segment: StudioRenderSegment; right: number; top: number; span: number };
type LineBox = { baseline: number; left: number; right: number; top: number; bottom: number };

export function measureLayout(frame: HTMLElement, element: StudioTextElement, size: number, scale = 1): StudioMeasuredText {
  const origin = frame.getBoundingClientRect();
  const segments: StudioRenderSegment[] = [];
  const lines: LineBox[] = [];
  let open: Open | null = null;
  const close = () => {
    if (open) segments.push(open.segment);
    open = null;
  };
  const addToLine = (baseline: number, left: number, right: number, top: number, bottom: number) => {
    const line = lines.find((item) => Math.abs(item.baseline - baseline) < SAME_LINE);
    if (!line) {
      lines.push({ baseline, left, right, top, bottom });
      return;
    }
    line.left = Math.min(line.left, left);
    line.right = Math.max(line.right, right);
    line.top = Math.min(line.top, top);
    line.bottom = Math.max(line.bottom, bottom);
  };
  const spans = Array.from(frame.querySelectorAll<HTMLElement>("span[data-run], span[data-marker]"));
  spans.forEach((span, spanIndex) => {
    const node = span.firstChild;
    if (!(node instanceof Text)) return;
    const data = span.dataset;
    const weight = data.w ? Number(data.w) : data.b === "1" ? BOLD_WEIGHT : REGULAR_WEIGHT;
    const pointSize = spanSize(span, size);
    const ascent = ascentOf(span, pointSize);
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
      const left = (rect.left - origin.left) / scale;
      const right = (rect.right - origin.left) / scale;
      const top = (rect.top - origin.top) / scale;
      const baseline = top + ascent;
      if (element.highlight) addToLine(baseline, left, right, top, (rect.bottom - origin.top) / scale);
      const current = open as Open | null;
      if (current && current.span === spanIndex && Math.abs(rect.top - current.top) < SAME_LINE && Math.abs(rect.left - current.right) < TOUCHING) {
        current.segment.text += char;
        current.right = rect.right;
        continue;
      }
      close();
      open = {
        span: spanIndex,
        top: rect.top,
        right: rect.right,
        segment: {
          text: char,
          x: left,
          y: baseline,
          size: pointSize,
          bold: weight >= 600,
          italic: data.i === "1",
          underline: data.u === "1",
          strike: data.s === "1",
          color: data.c ?? element.color,
          letterSpacing: element.letterSpacing * size,
          fontId: data.f || null,
          weight,
        },
      };
    }
    close();
  });
  close();
  const bands: StudioRenderBand[] = lines.map((line) => ({ x: line.left, y: line.top, width: line.right - line.left, height: line.bottom - line.top }));
  return { segments, bands };
}

export function buildTextNode(element: StudioTextElement, language: string): { frame: HTMLDivElement; body: HTMLDivElement } {
  const frame = document.createElement("div");
  const blocks = textBlocks(element, { language });
  frame.lang = element.language ?? language;
  frame.dir = textDirection(blocks.map((block) => block.spans.map((span) => span.text).join("")).join("\n"));
  applyCss(frame, { ...textFrameStyle(element), width: `${element.width}px`, height: `${element.height}px` });
  const body = document.createElement("div");
  body.dataset.textBody = "";
  applyCss(body, textBodyStyle(element, element.fontSize));
  body.append(...blockNodes(blocks, useStudioFontsStore.getState().faces, false));
  frame.append(body);
  return { frame, body };
}

function offscreenHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style";
  document.body.append(host);
  return host;
}

export function naturalTextSize(element: StudioTextElement, language: string): { width: number; height: number } {
  const host = offscreenHost();
  try {
    const { frame, body } = buildTextNode(element, language);
    if (element.autoSize === "width") body.style.minWidth = "0";
    host.append(frame);
    const rect = body.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  } finally {
    host.remove();
  }
}

export function fitTextBox(element: StudioTextElement, language: string): Pick<StudioTextElement, "x" | "y" | "width" | "height"> | null {
  if (element.autoSize !== "height" && element.autoSize !== "width") return null;
  const natural = naturalTextSize(element, language);
  const width = element.autoSize === "width" ? Math.max(MIN_ELEMENT_SIDE, Math.ceil(natural.width * 100) / 100) : element.width;
  const height = Math.max(MIN_ELEMENT_SIDE, Math.ceil(natural.height * 100) / 100);
  if (Math.abs(width - element.width) < FIT_TOLERANCE && Math.abs(height - element.height) < FIT_TOLERANCE) return null;
  const angle = (element.rotation * Math.PI) / 180;
  const shiftX = (0.5 - ANCHOR[element.align]) * (width - element.width);
  const shiftY = 0.5 * (height - element.height);
  const centreX = element.x + element.width / 2 + Math.cos(angle) * shiftX - Math.sin(angle) * shiftY;
  const centreY = element.y + element.height / 2 + Math.sin(angle) * shiftX + Math.cos(angle) * shiftY;
  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

const MEASURE_SLICE_MS = 12;

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function measureTexts(elements: StudioElement[], language: string): Promise<Map<string, StudioMeasuredText>> {
  const texts = elements.filter((element): element is StudioTextElement => element.kind === "text" && !element.hidden && textOf(element.runs).trim() !== "" && !hasPlaceholders(textOf(element.runs)));
  const measured = new Map<string, StudioMeasuredText>();
  if (!texts.length) return measured;
  await ensureElementFonts(texts);
  await document.fonts.ready;
  const host = offscreenHost();
  try {
    let sliceStart = performance.now();
    for (const element of texts) {
      if (performance.now() - sliceStart > MEASURE_SLICE_MS) {
        await nextTask();
        sliceStart = performance.now();
      }
      const { frame, body } = buildTextNode(element, language);
      host.append(frame);
      const size = fitTextSize(body, element);
      measured.set(element.id, measureLayout(frame, element, size));
      frame.remove();
    }
  } finally {
    host.remove();
  }
  return measured;
}
