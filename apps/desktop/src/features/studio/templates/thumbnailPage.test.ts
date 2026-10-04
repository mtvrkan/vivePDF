import { describe, expect, it } from "vitest";
import { createImage, createPage, createShape } from "../model/design";
import { placeholderOf, thumbnailPage, thumbnailSide } from "./thumbnailPage";

describe("template thumbnails", () => {
  it("draws an empty picture frame as a grey placeholder in the same place", () => {
    const frame = { ...createImage("", 40, 60, 120, 90), rotation: 15, opacity: 0.5 };
    const placeholder = placeholderOf(frame);
    expect(placeholder).toMatchObject({ id: frame.id, kind: "vector", x: 40, y: 60, width: 120, height: 90, rotation: 15, opacity: 0.5, viewWidth: 120, viewHeight: 90 });
    expect(placeholder.paths).toHaveLength(4);
    expect(placeholder.paths.every((path) => path.fill.type === "solid" && path.stroke === null)).toBe(true);
  });

  it("keeps pictures that have a file and every other element as they are", () => {
    const page = createPage(300, 300);
    const photo = createImage("C:/photo.png", 0, 0, 100, 100);
    const empty = { ...createImage("", 100, 100, 50, 50), mask: "circle" as const };
    const shape = createShape("rect", 10, 10, 20, 20);
    const result = thumbnailPage({ ...page, elements: [photo, empty, shape] });
    expect(result.elements[0]).toBe(photo);
    expect(result.elements[1].kind).toBe("vector");
    expect(result.elements[2]).toBe(shape);
    expect(page.elements).toHaveLength(0);
  });

  it("sizes the picture for the screen density and never beyond the cap", () => {
    expect(thumbnailSide(140, 1)).toBe(175);
    expect(thumbnailSide(140, 2)).toBe(350);
    expect(thumbnailSide(600, 3)).toBe(640);
  });
});
