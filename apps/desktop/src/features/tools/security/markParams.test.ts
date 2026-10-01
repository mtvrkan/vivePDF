import { describe, expect, it } from "vitest";
import { stampMarkParams, watermarkHasContent, watermarkMarkParams } from "./markParams";
import type { StampForm } from "./StampSection";
import type { WatermarkForm } from "./WatermarkSection";

const watermark: WatermarkForm = {
  kind: "text",
  templatePath: "C:/marks/logo.pdf",
  templatePage: 2,
  text: "TASLAK",
  imagePath: "C:/marks/logo.png",
  fontId: "bundled:dejavu-sans",
  fontSize: 48,
  bold: true,
  color: "#c00000",
  opacity: 30,
  rotation: 45,
  position: "center",
  scale: 50,
  tileGap: 100,
  offsetX: 4,
  offsetY: -2,
  behind: false,
  pages: "  ",
  side: "all",
  flatten: true,
  flattenDpi: 200,
  visibility: "print",
};

const stamp: StampForm = {
  stampPreset: "approved",
  stampText: "  ONAYLANDI ",
  stampName: " Ayşe ",
  stampFontId: "bundled:dejavu-sans",
  stampSize: 28,
  stampColor: "#1e8449",
  stampOpacity: 85,
  stampRotation: -12,
  stampPosition: "top-right",
  stampOffsetX: 0,
  stampOffsetY: 0,
  stampBehind: false,
  stampPages: "1-3",
  stampSide: "odd",
  stampBorder: true,
  stampDateFormat: "dd.MM.yyyy",
};

const source = { path: "C:/docs/a.pdf", password: "secret" };

describe("watermarkMarkParams", () => {
  it("sends only the field of the chosen kind and scales percentages", () => {
    const params = watermarkMarkParams(watermark, source);
    expect(params).toMatchObject({ path: source.path, password: "secret", kind: "text", text: "TASLAK", opacity: 0.3, scale: 0.5, offsetX: 4, offsetY: -2 });
    expect(params.imagePath).toBeUndefined();
    expect(params.templatePath).toBeUndefined();
    expect(params.pages).toBeUndefined();
    expect(params).not.toHaveProperty("flatten");
  });

  it("carries the template page for a PDF mark", () => {
    const params = watermarkMarkParams({ ...watermark, kind: "pdf" }, source);
    expect(params).toMatchObject({ templatePath: "C:/marks/logo.pdf", templatePage: 2 });
    expect(params.text).toBeUndefined();
  });

  it("knows when a mark has nothing to draw", () => {
    expect(watermarkHasContent({ ...watermark, text: "   " })).toBe(false);
    expect(watermarkHasContent({ ...watermark, kind: "image", imagePath: "" })).toBe(false);
    expect(watermarkHasContent({ ...watermark, kind: "pdf" })).toBe(true);
  });
});

describe("stampMarkParams", () => {
  it("trims text, name and pages and scales opacity", () => {
    expect(stampMarkParams(stamp, source)).toEqual({
      path: source.path,
      password: "secret",
      text: "ONAYLANDI",
      name: "Ayşe",
      fontSize: 28,
      color: "#1e8449",
      fontId: "bundled:dejavu-sans",
      behind: false,
      offsetX: 0,
      offsetY: 0,
      position: "top-right",
      rotation: -12,
      opacity: 0.85,
      border: true,
      dateFormat: "dd.MM.yyyy",
      pages: "1-3",
      side: "odd",
    });
  });

  it("drops blank page ranges", () => {
    expect(stampMarkParams({ ...stamp, stampPages: " " }, source).pages).toBeUndefined();
  });
});
