import { describe, expect, it } from "vitest";
import { fitInto, printSheetCss, sheetSize } from "./printLayout";

describe("sheetSize", () => {
  it("prints on paper the size of the first page", () => {
    const sheet = sheetSize({ width: 612, height: 792 });

    expect(sheet).toEqual({ width: 612, height: 792 });
  });

  it("falls back to A4 when the first page has no usable size", () => {
    const sheets = [sheetSize(undefined), sheetSize({ width: 0, height: 842 }), sheetSize({ width: Number.NaN, height: 10 })];

    expect(sheets).toEqual([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
  });
});

describe("fitInto", () => {
  it("shrinks a landscape page into a portrait sheet keeping its shape", () => {
    const fitted = fitInto({ width: 842, height: 595 }, { width: 595, height: 842 });

    expect(fitted.width).toBeCloseTo(595);
    expect(fitted.height).toBeCloseTo(420.5, 0);
  });

  it("grows a small page to fill the sheet", () => {
    const fitted = fitInto({ width: 297.5, height: 421 }, { width: 595, height: 842 });

    expect(fitted).toEqual({ width: 595, height: 842 });
  });

  it("gives a page without a usable size the whole sheet", () => {
    const fitted = fitInto({ width: 0, height: 0 }, { width: 595, height: 842 });

    expect(fitted).toEqual({ width: 595, height: 842 });
  });
});

describe("printSheetCss", () => {
  it("sets the paper size, hides the rest of the page in print and hides the pages on screen", () => {
    const css = printSheetCss({ width: 612, height: 792 });

    expect(css).toContain("@page { size: 612pt 792pt; margin: 0; }");
    expect(css).toContain("body > :not(.vivepdf-print-root) { display: none !important; }");
    expect(css).toContain("@media screen { .vivepdf-print-root { display: none !important; } }");
  });
});
