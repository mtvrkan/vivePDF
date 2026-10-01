import { describe, expect, it } from "vitest";
import type { TextEdit, TextSpan } from "@/types";
import { sameAsSpan } from "./textEditState";

const span: TextSpan = { id: "0-0-0", text: "Fatura", bbox: [10, 10, 60, 22], font: "Helvetica", fontXref: 0, size: 12, color: "#1a2b3c", bold: false, italic: false, opacity: 0.5 };
const edit = (patch: Partial<TextEdit>): TextEdit => ({ bbox: span.bbox, text: span.text, size: span.size, color: span.color, bold: span.bold, italic: span.italic, opacity: span.opacity, ...patch });

describe("sameAsSpan", () => {
  it("treats an edit that restores every original value as no edit", () => {
    expect(sameAsSpan(edit({ color: "#1A2B3C" }), span)).toBe(true);
  });

  it("notices a change in text, size, style or opacity", () => {
    expect(sameAsSpan(edit({ text: "Fatura 2" }), span)).toBe(false);
    expect(sameAsSpan(edit({ size: 13 }), span)).toBe(false);
    expect(sameAsSpan(edit({ bold: true }), span)).toBe(false);
    expect(sameAsSpan(edit({ opacity: 1 }), span)).toBe(false);
  });

  it("counts a span without an opacity as fully opaque", () => {
    expect(sameAsSpan(edit({ opacity: undefined }), { ...span, opacity: undefined })).toBe(true);
  });
});
