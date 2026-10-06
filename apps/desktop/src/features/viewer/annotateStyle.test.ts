import { describe, expect, it } from "vitest";
import { PdfAnnotationBorderStyle, PdfAnnotationSubtype } from "@embedpdf/models";
import { NO_FILL, SUBTYPE_TOOLS, stylePatchFor, toolColorFrom } from "./annotateStyle";

describe("stylePatchFor colour routing", () => {
  it("sends colour to the outline for shapes and leaves fill alone", () => {
    expect(stylePatchFor("square", { color: "#FF0000" })).toEqual({ strokeColor: "#FF0000" });
    expect(stylePatchFor("circle", { color: "#FF0000" })).toEqual({ strokeColor: "#FF0000" });
  });

  it("sends colour to the pen's line, which is what a drawn stroke is painted with", () => {
    expect(stylePatchFor("ink", { color: "#3E63DD" })).toEqual({ strokeColor: "#3E63DD" });
  });

  it("sends colour to the body for markup", () => {
    expect(stylePatchFor("highlight", { color: "#FF0000" })).toEqual({ color: "#FF0000" });
  });

  it("also sets the rule colour for underline, strikeout and squiggly", () => {
    for (const tool of ["underline", "strikeout", "squiggly"]) {
      expect(stylePatchFor(tool, { color: "#00A0FF" })).toEqual({ color: "#00A0FF", strokeColor: "#00A0FF" });
    }
  });

  it("colours only the text of text boxes and leaves their background alone", () => {
    expect(stylePatchFor("freeText", { color: "#FF0000" })).toEqual({ fontColor: "#FF0000" });
  });
});

describe("stylePatchFor fill", () => {
  it("writes the transparent literal when fill is turned off", () => {
    expect(stylePatchFor("square", { fill: null })).toEqual({ color: NO_FILL });
    expect(NO_FILL).toBe("transparent");
  });

  it("writes the chosen fill colour", () => {
    expect(stylePatchFor("square", { fill: "#00FF00" })).toEqual({ color: "#00FF00" });
  });

  it("ignores fill for tools that cannot be filled", () => {
    expect(stylePatchFor("ink", { fill: "#00FF00" })).toEqual({});
    expect(stylePatchFor("line", { fill: "#00FF00" })).toEqual({});
  });

  it("keeps outline and fill independent", () => {
    expect(stylePatchFor("square", { color: "#FF0000", fill: "#00FF00" })).toEqual({ strokeColor: "#FF0000", color: "#00FF00" });
  });
});

describe("stylePatchFor stroke width, dash and opacity", () => {
  it("applies stroke width only to stroke tools", () => {
    expect(stylePatchFor("square", { strokeWidth: 4 })).toEqual({ strokeWidth: 4 });
    expect(stylePatchFor("highlight", { strokeWidth: 4 })).toEqual({});
  });

  it("maps dashed on and off with a dash pattern", () => {
    expect(stylePatchFor("square", { dashed: true })).toEqual({ strokeStyle: PdfAnnotationBorderStyle.DASHED, strokeDashArray: [4, 3] });
    expect(stylePatchFor("square", { dashed: false })).toEqual({ strokeStyle: PdfAnnotationBorderStyle.SOLID, strokeDashArray: [] });
  });

  it("ignores dash for tools without a border style", () => {
    expect(stylePatchFor("ink", { dashed: true })).toEqual({});
    expect(stylePatchFor("highlight", { dashed: true })).toEqual({});
  });

  it("applies opacity to every tool", () => {
    expect(stylePatchFor("highlight", { opacity: 0.5 })).toEqual({ opacity: 0.5 });
    expect(stylePatchFor("square", { opacity: 0.5 })).toEqual({ opacity: 0.5 });
  });
});

describe("SUBTYPE_TOOLS", () => {
  it("maps a selected shape back to its tool so its own properties are edited", () => {
    expect(SUBTYPE_TOOLS[PdfAnnotationSubtype.SQUARE]).toBe("square");
    expect(SUBTYPE_TOOLS[PdfAnnotationSubtype.CIRCLE]).toBe("circle");
    expect(SUBTYPE_TOOLS[PdfAnnotationSubtype.INK]).toBe("ink");
    expect(SUBTYPE_TOOLS[PdfAnnotationSubtype.FREETEXT]).toBe("freeText");
    expect(SUBTYPE_TOOLS[PdfAnnotationSubtype.SQUIGGLY]).toBe("squiggly");
  });
});

describe("toolColorFrom", () => {
  it("reads the colour each tool actually paints with", () => {
    expect(toolColorFrom("ink", { strokeColor: "#E44234", color: "#FFD400" })).toBe("#E44234");
    expect(toolColorFrom("highlight", { color: "#FFD400" })).toBe("#FFD400");
    expect(toolColorFrom("freeText", { fontColor: "#111111", color: "transparent" })).toBe("#111111");
  });

  it("has no colour for a tool without defaults", () => {
    expect(toolColorFrom("ink", undefined)).toBeNull();
  });
});
