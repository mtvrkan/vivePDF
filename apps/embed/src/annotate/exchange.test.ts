import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import type { VivePdfAnnotation } from "../api/types";
import { MAX_ANNOTATIONS, readAnnotationList, toPublic } from "./exchange";

const PAGES = [
  { width: 595, height: 842 },
  { width: 842, height: 595 },
];

function counter(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

function roundTrip(list: VivePdfAnnotation[]): (VivePdfAnnotation | null)[] {
  return readAnnotationList(list, PAGES, counter()).map(toPublic);
}

function failure(list: unknown): string {
  try {
    readAnnotationList(list, PAGES, counter());
  } catch (error) {
    return `${(error as { code: string }).code}: ${(error as Error).message}`;
  }
  return "accepted";
}

describe("annotation exchange", () => {
  it("brings every kind of annotation back the way it was given", () => {
    const list: VivePdfAnnotation[] = [
      { type: "pen", page: 1, color: "#E44234", opacity: 1, width: 4, strokes: [[{ x: 10, y: 20 }, { x: 30, y: 40 }], [{ x: 50, y: 60 }, { x: 70, y: 80 }]] },
      { type: "marker", page: 1, color: "#FFCD45", opacity: 1, width: 16, strokes: [[{ x: 100, y: 100 }, { x: 200, y: 100 }]] },
      { type: "highlight", page: 2, color: "#2EA043", opacity: 1, boxes: [{ x: 72, y: 80, width: 200, height: 18 }] },
      { type: "underline", page: 1, color: "#1F6FEB", opacity: 1, boxes: [{ x: 72, y: 80, width: 200, height: 18 }] },
      { type: "strikeout", page: 1, color: "#8957E5", opacity: 0.5, boxes: [{ x: 72, y: 80, width: 200, height: 18 }] },
      { type: "note", page: 1, color: "#FFCD45", opacity: 1, text: "Çalışkan öğrenci İĞDIR", box: { x: 400, y: 90, width: 20, height: 20 } },
      { type: "rectangle", page: 1, color: "#E44234", opacity: 1, width: 4, box: { x: 100, y: 300, width: 200, height: 100 } },
      { type: "ellipse", page: 2, color: "#1F2328", opacity: 1, width: 2, box: { x: 100, y: 300, width: 200, height: 100 } },
      { type: "arrow", page: 1, color: "#E44234", opacity: 1, width: 4, from: { x: 100, y: 500 }, to: { x: 300, y: 600 } },
      { type: "line", page: 1, color: "#E44234", opacity: 1, width: 4, from: { x: 100, y: 500 }, to: { x: 300, y: 600 } },
    ];

    const back = roundTrip(list);

    expect(back).toEqual(list);
  });

  it("fills in full opacity, upper-case colours and no text, and strips control characters from notes", () => {
    const [plain, note] = roundTrip([
      { type: "rectangle", page: 1, color: "#e44234", width: 2, box: { x: 10, y: 10, width: 20, height: 20 } },
      { type: "note", page: 1, color: "#ffcd45", text: "a\u0000b\u0007c\nd", box: { x: 10, y: 10, width: 20, height: 20 } },
    ]);

    expect([plain, note]).toEqual([
      { type: "rectangle", page: 1, color: "#E44234", opacity: 1, width: 2, box: { x: 10, y: 10, width: 20, height: 20 } },
      { type: "note", page: 1, color: "#FFCD45", opacity: 1, text: "abc\nd", box: { x: 10, y: 10, width: 20, height: 20 } },
    ]);
  });

  it("gives every created annotation a fresh id and a page index", () => {
    const created = readAnnotationList([{ type: "note", page: 2, color: "#FFCD45", box: { x: 1, y: 1, width: 20, height: 20 } }], PAGES, counter());

    expect(created.map((entry) => [entry.id, entry.pageIndex, entry.type])).toEqual([["id-1", 1, PdfAnnotationSubtype.TEXT]]);
  });

  it("leaves out links, form fields, replies and other kinds it does not draw", () => {
    const others = [
      { type: PdfAnnotationSubtype.LINK, id: "a", pageIndex: 0, rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } } },
      { type: PdfAnnotationSubtype.TEXT, id: "b", pageIndex: 0, contents: "reply", inReplyToId: "c", rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } } },
    ] as PdfAnnotationObject[];

    const exported = others.map(toPublic);

    expect(exported).toEqual([null, null]);
  });

  it("refuses input that is not a list or is too long", () => {
    const messages = [failure({}), failure(Array.from({ length: MAX_ANNOTATIONS + 1 }, () => null))];

    expect(messages).toEqual(["invalid: vive-pdf: setAnnotations needs a list", `invalid: vive-pdf: a document can take at most ${MAX_ANNOTATIONS} annotations`]);
  });

  it("names the first annotation that is wrong and why", () => {
    const messages = [
      failure([{ type: "stamp", page: 1, color: "#000000" }]),
      failure([{ type: "note", page: 3, color: "#000000", box: { x: 1, y: 1, width: 1, height: 1 } }]),
      failure([{ type: "note", page: 1, color: "red", box: { x: 1, y: 1, width: 1, height: 1 } }]),
      failure([{ type: "pen", page: 1, color: "#000000", width: 4, strokes: [[{ x: Number.NaN, y: 1 }]] }]),
      failure([{ type: "note", page: 1, color: "#000000", text: "x".repeat(2001), box: { x: 1, y: 1, width: 1, height: 1 } }]),
      failure([{ type: "rectangle", page: 1, color: "#000000", width: 500, box: { x: 1, y: 1, width: 1, height: 1 } }]),
      failure([{ type: "highlight", page: 1, color: "#000000", boxes: [] }]),
    ];

    expect(messages.map((message) => message.replace(/^invalid: vive-pdf: annotation 0 is not valid: /, ""))).toEqual([
      "type must be pen, marker, highlight, underline, strikeout, note, rectangle, ellipse, line or arrow",
      "page must be a whole number from 1 to 2",
      "color must look like #rrggbb",
      "strokes[0][0].x must be a number from -595 to 1190",
      "text must be a string of at most 2000 characters",
      "width must be a number from 0.1 to 100",
      "boxes must be a list of 1 to 1000 entries",
    ]);
  });

  it("refuses a link or an image hidden in an otherwise valid entry by ignoring fields it does not know", () => {
    const [created] = readAnnotationList([{ type: "note", page: 1, color: "#FFCD45", box: { x: 1, y: 1, width: 20, height: 20 }, uri: "javascript:alert(1)", imageData: "AAAA", custom: { a: 1 } }], PAGES, counter());

    expect(Object.keys(created).sort()).toEqual(["author", "color", "contents", "created", "flags", "id", "opacity", "pageIndex", "rect", "strokeColor", "type"]);
  });
});
