import { describe, expect, it } from "vitest";
import { addElements } from "./edit";
import { addGuide, clearGuides, guidesOf, marginsOf, moveGuide, removeGuide, withMargins } from "./guides";
import { createDesign, createShape, MAX_GUIDES_PER_PAGE, normalizeDesign } from "./design";
import { pageToRender } from "./render";

describe("page guides and margins", () => {
  it("adds, moves and removes guides without touching the elements", () => {
    const page = createDesign("Flyer", 400, 300).pages[0];

    const added = addGuide(addGuide(page, { axis: "x", position: 40 }), { axis: "y", position: 120 });
    const moved = moveGuide(added, 0, 55);
    const removed = removeGuide(moved, 1);

    expect(guidesOf(added)).toEqual([{ axis: "x", position: 40 }, { axis: "y", position: 120 }]);
    expect(guidesOf(moved)[0].position).toBe(55);
    expect(guidesOf(removed)).toEqual([{ axis: "x", position: 55 }]);
    expect(removed.elements).toBe(page.elements);
    expect(guidesOf(clearGuides(removed))).toEqual([]);
  });

  it("ignores impossible guide edits", () => {
    const page = createDesign("Flyer", 400, 300).pages[0];
    let full = page;
    for (let index = 0; index < MAX_GUIDES_PER_PAGE; index += 1) full = addGuide(full, { axis: "x", position: index });

    expect(addGuide(full, { axis: "y", position: 1 })).toBe(full);
    expect(addGuide(page, { axis: "y", position: Number.NaN })).toBe(page);
    expect(moveGuide(page, 3, 10)).toBe(page);
    expect(removeGuide(page, 0)).toBe(page);
    expect(guidesOf({ ...page, guides: undefined })).toEqual([]);
  });

  it("keeps guides and margins out of the exported page", () => {
    const design = createDesign("Flyer", 400, 300);
    const page = addGuide(addElements(design.pages[0], [createShape("rect", 0, 0, 10, 10)]), { axis: "x", position: 40 });

    const rendered = pageToRender(page);

    expect(Object.keys(rendered)).toEqual(["width", "height", "items"]);
    expect(rendered).toEqual(pageToRender({ ...page, guides: [] }));
  });

  it("clamps the page margins and loads old designs without them", () => {
    const design = createDesign("Flyer", 400, 300);

    expect(marginsOf(design)).toBe(0);
    expect(marginsOf(withMargins(design, 12.5))).toBe(12.5);
    expect(marginsOf(withMargins(design, -4))).toBe(0);
    expect(marginsOf(withMargins(design, 9000))).toBe(500);
    expect(withMargins(design, 0)).toBe(design);
    const old = normalizeDesign({ version: 1, kind: "design", name: "Old", palette: [], pages: [{ id: "p", width: 100, height: 100, elements: [] }] });
    expect(old?.margins).toBe(0);
    expect(old?.pages[0].guides).toEqual([]);
  });

  it("normalises stored guides and drops broken ones", () => {
    const design = normalizeDesign({
      version: 1,
      kind: "design",
      name: "Saved",
      margins: "wide",
      pages: [{ id: "p", width: 100, height: 100, elements: [], guides: [{ axis: "x", position: 10 }, { axis: "z", position: 4 }, { axis: "y", position: "5" }, null, { axis: "y", position: 1e9 }] }],
    });

    expect(design?.margins).toBe(0);
    expect(design?.pages[0].guides).toEqual([{ axis: "x", position: 10 }, { axis: "y", position: 28800 }]);
    expect(normalizeDesign(JSON.parse(JSON.stringify(design)))).toEqual(design);
  });
});
