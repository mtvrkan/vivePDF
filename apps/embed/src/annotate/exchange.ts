import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  PdfBlendMode,
  type PdfAnnotationObject,
  type Position,
  type Rect,
} from "@embedpdf/models";
import { patching } from "@embedpdf/plugin-annotation";
import { annotateError } from "../api/errors";
import type { VivePdfAnnotation, VivePdfBox, VivePdfPoint } from "../api/types";
import { NOTE_MAX_LENGTH } from "./tools";

export const MAX_ANNOTATIONS = 5000;
export const MAX_POINTS = 20000;
export const MAX_BOXES = 1000;
const MIN_WIDTH = 0.1;
const MAX_WIDTH = 100;
const DECIMALS = 100;
const COLOR = /^#[0-9a-f]{6}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MARKER_INTENT = "InkHighlight";
const ARROW_INTENT = "LineArrow";

export type PageSize = { width: number; height: number };

type Cursor = { index: number; page: PageSize };
type Fields = Record<string, unknown>;

function invalid(index: number, reason: string): never {
  throw annotateError("invalid", `annotation ${index} is not valid: ${reason}`);
}

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(cursor: Cursor, value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(cursor.index, `${name} must be a number from ${min} to ${max}`);
  return value;
}

function readPoint(cursor: Cursor, value: unknown, name: string): Position {
  if (!isFields(value)) invalid(cursor.index, `${name} must be an object with x and y`);
  const { width, height } = cursor.page;
  return { x: readNumber(cursor, value.x, `${name}.x`, -width, 2 * width), y: readNumber(cursor, value.y, `${name}.y`, -height, 2 * height) };
}

function readBox(cursor: Cursor, value: unknown, name: string): Rect {
  if (!isFields(value)) invalid(cursor.index, `${name} must be an object with x, y, width and height`);
  const origin = readPoint(cursor, value, name);
  const { width, height } = cursor.page;
  return { origin, size: { width: readNumber(cursor, value.width, `${name}.width`, 0, 2 * width), height: readNumber(cursor, value.height, `${name}.height`, 0, 2 * height) } };
}

function readList(cursor: Cursor, value: unknown, name: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) invalid(cursor.index, `${name} must be a list of 1 to ${limit} entries`);
  return value;
}

function readColor(cursor: Cursor, value: unknown): string {
  if (typeof value !== "string" || !COLOR.test(value)) invalid(cursor.index, "color must look like #rrggbb");
  return value.toUpperCase();
}

function readText(cursor: Cursor, value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > NOTE_MAX_LENGTH) invalid(cursor.index, `text must be a string of at most ${NOTE_MAX_LENGTH} characters`);
  return value.replace(CONTROL_CHARACTERS, "");
}

function expand(rect: Rect, by: number): Rect {
  return { origin: { x: rect.origin.x - by, y: rect.origin.y - by }, size: { width: rect.size.width + 2 * by, height: rect.size.height + 2 * by } };
}

function bounds(points: readonly Position[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { origin: { x: left, y: top }, size: { width: Math.max(...xs) - left, height: Math.max(...ys) - top } };
}

function union(rects: readonly Rect[]): Rect {
  return bounds(rects.flatMap((rect) => [rect.origin, { x: rect.origin.x + rect.size.width, y: rect.origin.y + rect.size.height }]));
}

function readEntry(value: unknown, index: number, pages: readonly PageSize[], makeId: () => string): PdfAnnotationObject {
  if (!isFields(value)) invalid(index, "it must be an object");
  const pageNumber = value.page;
  if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) invalid(index, `page must be a whole number from 1 to ${pages.length}`);
  const cursor: Cursor = { index, page: pages[pageNumber - 1] };
  const color = readColor(cursor, value.color);
  const common = {
    id: makeId(),
    pageIndex: pageNumber - 1,
    author: "",
    created: new Date(),
    flags: ["print" as const],
    contents: readText(cursor, value.text),
    opacity: value.opacity === undefined ? 1 : readNumber(cursor, value.opacity, "opacity", 0, 1),
  };
  const width = () => readNumber(cursor, value.width, "width", MIN_WIDTH, MAX_WIDTH);
  switch (value.type) {
    case "pen":
    case "marker": {
      const strokeWidth = width();
      const strokes = readList(cursor, value.strokes, "strokes", MAX_POINTS).map((stroke, strokeIndex) => readList(cursor, stroke, `strokes[${strokeIndex}]`, MAX_POINTS).map((point, pointIndex) => readPoint(cursor, point, `strokes[${strokeIndex}][${pointIndex}]`)));
      const points = strokes.flat();
      if (points.length > MAX_POINTS) invalid(index, `a drawing can have at most ${MAX_POINTS} points`);
      const marker = value.type === "marker";
      return {
        ...common,
        type: PdfAnnotationSubtype.INK,
        inkList: strokes.map((stroke) => ({ points: stroke })),
        strokeColor: color,
        color,
        strokeWidth,
        rect: expand(bounds(points), strokeWidth / 2),
        ...(marker ? { intent: MARKER_INTENT, blendMode: PdfBlendMode.Multiply } : {}),
      };
    }
    case "highlight":
    case "underline":
    case "strikeout": {
      const segmentRects = readList(cursor, value.boxes, "boxes", MAX_BOXES).map((box, boxIndex) => readBox(cursor, box, `boxes[${boxIndex}]`));
      const shared = { ...common, strokeColor: color, color, segmentRects, rect: union(segmentRects) };
      if (value.type === "highlight") return { ...shared, type: PdfAnnotationSubtype.HIGHLIGHT, blendMode: PdfBlendMode.Multiply };
      if (value.type === "underline") return { ...shared, type: PdfAnnotationSubtype.UNDERLINE };
      return { ...shared, type: PdfAnnotationSubtype.STRIKEOUT };
    }
    case "note":
      return { ...common, type: PdfAnnotationSubtype.TEXT, strokeColor: color, color, rect: readBox(cursor, value.box, "box") };
    case "rectangle":
    case "ellipse": {
      const strokeWidth = width();
      const shape = { ...common, color: "transparent", strokeColor: color, strokeWidth, strokeStyle: PdfAnnotationBorderStyle.SOLID, rect: expand(readBox(cursor, value.box, "box"), strokeWidth / 2) };
      return value.type === "rectangle" ? { ...shape, type: PdfAnnotationSubtype.SQUARE } : { ...shape, type: PdfAnnotationSubtype.CIRCLE };
    }
    case "line":
    case "arrow": {
      const strokeWidth = width();
      const start = readPoint(cursor, value.from, "from");
      const end = readPoint(cursor, value.to, "to");
      const arrow = value.type === "arrow";
      const lineEndings = { start: PdfAnnotationLineEnding.None, end: arrow ? PdfAnnotationLineEnding.OpenArrow : PdfAnnotationLineEnding.None };
      return {
        ...common,
        type: PdfAnnotationSubtype.LINE,
        color: "transparent",
        strokeColor: color,
        strokeWidth,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
        linePoints: { start, end },
        lineEndings,
        rect: patching.lineRectWithEndings([start, end], strokeWidth, lineEndings),
        ...(arrow ? { intent: ARROW_INTENT } : {}),
      };
    }
    default:
      return invalid(index, "type must be pen, marker, highlight, underline, strikeout, note, rectangle, ellipse, line or arrow");
  }
}

export function readAnnotationList(value: unknown, pages: readonly PageSize[], makeId: () => string): PdfAnnotationObject[] {
  if (!Array.isArray(value)) throw annotateError("invalid", "setAnnotations needs a list");
  if (value.length > MAX_ANNOTATIONS) throw annotateError("invalid", `a document can take at most ${MAX_ANNOTATIONS} annotations`);
  return value.map((entry, index) => readEntry(entry, index, pages, makeId));
}

function round(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function point(position: Position): VivePdfPoint {
  return { x: round(position.x), y: round(position.y) };
}

function box(rect: Rect, inset = 0): VivePdfBox {
  return { x: round(rect.origin.x + inset), y: round(rect.origin.y + inset), width: round(Math.max(0, rect.size.width - 2 * inset)), height: round(Math.max(0, rect.size.height - 2 * inset)) };
}

function colorOf(...candidates: (string | undefined)[]): string {
  return (candidates.find((candidate) => candidate !== undefined && COLOR.test(candidate)) ?? "#000000").toUpperCase();
}

export function toPublic(object: PdfAnnotationObject): VivePdfAnnotation | null {
  if (object.inReplyToId) return null;
  const base = { page: object.pageIndex + 1, opacity: "opacity" in object && typeof object.opacity === "number" ? round(object.opacity) : 1, ...(object.contents ? { text: object.contents } : {}) };
  switch (object.type) {
    case PdfAnnotationSubtype.INK:
      return { ...base, type: object.intent === MARKER_INTENT ? "marker" : "pen", color: colorOf(object.strokeColor, object.color), width: round(object.strokeWidth), strokes: object.inkList.map((stroke) => stroke.points.map(point)) };
    case PdfAnnotationSubtype.HIGHLIGHT:
    case PdfAnnotationSubtype.UNDERLINE:
    case PdfAnnotationSubtype.STRIKEOUT: {
      const type = object.type === PdfAnnotationSubtype.HIGHLIGHT ? "highlight" : object.type === PdfAnnotationSubtype.UNDERLINE ? "underline" : "strikeout";
      return { ...base, type, color: colorOf(object.strokeColor, object.color), boxes: object.segmentRects.map((rect) => box(rect)) };
    }
    case PdfAnnotationSubtype.TEXT:
      return { ...base, type: "note", color: colorOf(object.strokeColor, object.color), box: box(object.rect) };
    case PdfAnnotationSubtype.SQUARE:
    case PdfAnnotationSubtype.CIRCLE:
      return { ...base, type: object.type === PdfAnnotationSubtype.SQUARE ? "rectangle" : "ellipse", color: colorOf(object.strokeColor), width: round(object.strokeWidth), box: box(object.rect, object.strokeWidth / 2) };
    case PdfAnnotationSubtype.LINE: {
      const arrow = object.lineEndings !== undefined && object.lineEndings.end !== PdfAnnotationLineEnding.None;
      return { ...base, type: arrow ? "arrow" : "line", color: colorOf(object.strokeColor), width: round(object.strokeWidth), from: point(object.linePoints.start), to: point(object.linePoints.end) };
    }
    default:
      return null;
  }
}
