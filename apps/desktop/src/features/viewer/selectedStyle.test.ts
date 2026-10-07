import { describe, expect, it } from "vitest";
import { PdfAnnotationBorderStyle, PdfAnnotationSubtype } from "@embedpdf/models";
import { styleValuesOf } from "./selectedStyle";

describe("styleValuesOf", () => {
  it("reads stroke colour, fill, width, opacity and dash from a shape", () => {
    const values = styleValuesOf({ type: PdfAnnotationSubtype.SQUARE, strokeColor: "#112233", color: "#445566", strokeWidth: 4, opacity: 0.5, strokeStyle: PdfAnnotationBorderStyle.DASHED } as never);
    expect(values).toEqual({ color: "#112233", fill: "#445566", strokeWidth: 4, opacity: 0.5, dashed: true });
  });

  it("treats a transparent shape colour as no fill", () => {
    expect(styleValuesOf({ type: PdfAnnotationSubtype.CIRCLE, strokeColor: "#112233", color: "transparent" } as never).fill).toBeNull();
  });

  it("reads the plain colour of a highlight and nothing for unknown subtypes", () => {
    expect(styleValuesOf({ type: PdfAnnotationSubtype.HIGHLIGHT, color: "#ffee00", opacity: 0.4 } as never)).toMatchObject({ color: "#ffee00", opacity: 0.4 });
    expect(styleValuesOf({ type: PdfAnnotationSubtype.LINK } as never)).toEqual({});
  });
});
