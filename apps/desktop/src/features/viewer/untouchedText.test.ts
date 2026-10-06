import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { ENGINE_TEXT_PLACEHOLDER, droppedUntouchedTexts, isUntouchedText } from "./untouchedText";

const text = (id: string, contents: string) => ({ id, type: PdfAnnotationSubtype.FREETEXT, pageIndex: 1, contents }) as unknown as PdfAnnotationObject;
const ink = (id: string) => ({ id, type: PdfAnnotationSubtype.INK, pageIndex: 0 }) as unknown as PdfAnnotationObject;
const placeholders = [ENGINE_TEXT_PLACEHOLDER, "Metin yazın"];

describe("isUntouchedText", () => {
  it("treats a text box still showing its placeholder or nothing as untouched", () => {
    expect(isUntouchedText(text("a", "Insert text"), placeholders)).toBe(true);
    expect(isUntouchedText(text("b", "  "), placeholders)).toBe(true);
    expect(isUntouchedText(text("c", "Metin yazın"), placeholders)).toBe(true);
  });

  it("keeps a text box someone typed in, and anything that is not a text box", () => {
    expect(isUntouchedText(text("a", "deneme"), placeholders)).toBe(false);
    expect(isUntouchedText(ink("b"), placeholders)).toBe(false);
    expect(isUntouchedText(undefined, placeholders)).toBe(false);
  });
});

describe("droppedUntouchedTexts", () => {
  it("lists untouched text boxes that just lost the selection", () => {
    const byUid = { a: { object: text("a", "Insert text") }, b: { object: text("b", "hello") }, c: { object: text("c", "") }, d: { object: ink("d") } };

    const dropped = droppedUntouchedTexts(["a", "b", "c", "d"], ["c"], byUid, placeholders);

    expect(dropped).toEqual([{ pageIndex: 1, id: "a" }]);
  });

  it("finds nothing when the selection did not change", () => {
    expect(droppedUntouchedTexts(["a"], ["a"], { a: { object: text("a", "") } }, placeholders)).toEqual([]);
  });
});
