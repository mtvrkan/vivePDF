import { describe, expect, it } from "vitest";
import type { StudioPage } from "@/types/studio";
import { createDesign, createPage, createShape, createText } from "./design";
import {
  alignElements,
  distributableCount,
  distributeElements,
  duplicateElements,
  elementBounds,
  expandToGroups,
  moveElements,
  removeElements,
  selectionBounds,
  withoutGroupOf,
} from "./edit";
import {
  groupElements,
  layerRuns,
  placeElements,
  reorderElements,
  ungroupElements,
} from "./layers";
import {
  addPage,
  duplicatePage,
  movePage,
  removePage,
  resizeAllPages,
  resizePage,
} from "./pages";

function pageWith(...boxes: [number, number, number, number][]): StudioPage {
  const page = createPage(500, 400);
  page.elements = boxes.map(([x, y, width, height], index) => ({ ...createShape("rect", x, y, width, height), id: `e${index}` }));
  return page;
}

const ids = (page: StudioPage) => page.elements.map((element) => element.id);
const at = (page: StudioPage, id: string) => page.elements.find((element) => element.id === id);

describe("studio element editing", () => {
  it("measures rotated elements by their turned outline", () => {
    const bounds = elementBounds({ x: 100, y: 100, width: 100, height: 20, rotation: 90 });

    expect(bounds.x).toBeCloseTo(140);
    expect(bounds.y).toBeCloseTo(60);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(100);
  });

  it("moves groups together and leaves locked elements in place", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10]);
    page = groupElements(page, ["e0", "e1"]).page;
    page.elements[2].locked = true;

    page = moveElements(page, expandToGroups(page, ["e0", "e2"]), 5, 7);

    expect(at(page, "e1")).toMatchObject({ x: 25, y: 7 });
    expect(at(page, "e2")).toMatchObject({ x: 40, y: 0 });
  });

  it("aligns to the selection or to the page", () => {
    const page = pageWith([10, 10, 50, 20], [100, 50, 30, 30]);

    const right = alignElements(page, ["e0", "e1"], "right", "selection");
    const centred = alignElements(page, ["e0"], "centerX", "page");

    expect(at(right, "e0")?.x).toBe(80);
    expect(at(right, "e1")?.x).toBe(100);
    expect(at(centred, "e0")?.x).toBe(225);
  });

  it("spreads three or more elements with equal gaps", () => {
    const page = pageWith([0, 0, 10, 10], [15, 0, 30, 10], [90, 0, 10, 10]);

    const spread = distributeElements(page, ["e0", "e1", "e2"], "horizontal");

    expect(at(spread, "e1")?.x).toBe(35);
    expect(distributeElements(page, ["e0", "e1"], "horizontal")).toBe(page);
  });

  it("changes stacking order step by step or to the ends", () => {
    const page = pageWith([0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]);

    expect(ids(reorderElements(page, ["e0", "e1"], "forward"))).toEqual(["e2", "e0", "e1", "e3"]);
    expect(ids(reorderElements(page, ["e3"], "backward"))).toEqual(["e0", "e1", "e3", "e2"]);
    expect(ids(reorderElements(page, ["e1"], "front"))).toEqual(["e0", "e2", "e3", "e1"]);
    expect(ids(reorderElements(page, ["e2"], "back"))).toEqual(["e2", "e0", "e1", "e3"]);
    expect(reorderElements(page, ["missing"], "front")).toBe(page);
  });

  it("duplicates with fresh ids and a fresh group", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10]);
    const grouped = groupElements(page, ["e0", "e1"]);
    page = grouped.page;

    const copy = duplicateElements(page, ["e0", "e1"], 10);

    expect(copy.ids).toHaveLength(2);
    const copies = copy.page.elements.slice(2);
    expect(copies.every((element) => element.groupId && element.groupId !== grouped.groupId)).toBe(true);
    expect(new Set(copies.map((element) => element.groupId)).size).toBe(1);
    expect(copies[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("groups need two elements and ungrouping clears the whole group", () => {
    const page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10]);

    expect(groupElements(page, ["e0"]).groupId).toBeNull();
    const grouped = groupElements(page, ["e0", "e1"]).page;
    const ungrouped = ungroupElements(grouped, ["e1"]);

    expect(ungrouped.elements.every((element) => element.groupId === null)).toBe(true);
    expect(selectionBounds(grouped, expandToGroups(grouped, ["e0"]))).toEqual({ x: 0, y: 0, width: 30, height: 10 });
  });

  it("keeps locked elements when deleting", () => {
    const page = pageWith([0, 0, 10, 10], [20, 0, 10, 10]);
    page.elements[1].locked = true;

    expect(ids(removeElements(page, ["e0", "e1"]))).toEqual(["e1"]);
  });

  it("adds, copies, moves and removes pages but never the last one", () => {
    let design = createDesign("Deck", 100, 100);
    const first = design.pages[0].id;
    design.pages[0].elements.push(createShape("rect", 0, 0, 10, 10));

    const added = addPage(design, first);
    design = added.design;
    const copied = duplicatePage(design, first);
    design = copied.design;

    expect(design.pages.map((page) => page.id)).toEqual([first, copied.pageId, added.pageId]);
    expect(design.pages[1].elements[0].id).not.toBe(design.pages[0].elements[0].id);
    design = movePage(design, first, 99);
    expect(design.pages[2].id).toBe(first);
    design = removePage(removePage(design, first), copied.pageId as string);
    expect(design.pages).toHaveLength(1);
    expect(removePage(design, design.pages[0].id).pages).toHaveLength(1);
  });
});

describe("selection helpers", () => {
  it("drops a whole group from the selection when one of its members is clicked off", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10]);
    page = groupElements(page, ["e0", "e1"]).page;

    expect(withoutGroupOf(page, ["e0", "e1", "e2"], "e1")).toEqual(["e2"]);
    expect(withoutGroupOf(page, ["e0", "e1", "e2"], "e2")).toEqual(["e0", "e1"]);
  });

  it("counts a group as one unit and skips locked elements when distributing", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10], [60, 0, 10, 10]);
    page = groupElements(page, ["e0", "e1"]).page;
    page.elements[3] = { ...page.elements[3], locked: true };

    expect(distributableCount(page, ["e0", "e1", "e2", "e3"])).toBe(2);
    expect(distributableCount(page, [])).toBe(0);
  });
});

describe("layer order with groups", () => {
  function grouped(): StudioPage {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10], [60, 0, 10, 10], [80, 0, 10, 10]);
    page = groupElements(page, ["e1", "e2"]).page;
    return page;
  }

  it("gathers a new group next to its top member", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10], [60, 0, 10, 10]);
    page = groupElements(page, ["e0", "e2"]).page;

    expect(ids(page)).toEqual(["e1", "e0", "e2", "e3"]);
    expect(layerRuns(page.elements).map((run) => run.elements.map((element) => element.id))).toEqual([["e1"], ["e0", "e2"], ["e3"]]);
  });

  it("merges selected groups into one flat group instead of nesting them", () => {
    let page = pageWith([0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10], [60, 0, 10, 10]);
    const first = groupElements(page, ["e0", "e1"]);
    page = groupElements(first.page, ["e2", "e3"]).page;

    const merged = groupElements(page, ["e0", "e3"]);

    expect(new Set(merged.page.elements.map((element) => element.groupId))).toEqual(new Set([merged.groupId]));
    expect(ungroupElements(merged.page, ["e0"]).elements.every((element) => element.groupId === null)).toBe(true);
  });

  it("moves a whole group past its neighbours without splitting it", () => {
    const page = grouped();

    expect(ids(reorderElements(page, ["e1", "e2"], "forward"))).toEqual(["e0", "e3", "e1", "e2", "e4"]);
    expect(ids(reorderElements(page, ["e3"], "backward"))).toEqual(["e0", "e3", "e1", "e2", "e4"]);
    expect(ids(reorderElements(page, ["e0"], "forward"))).toEqual(["e1", "e2", "e0", "e3", "e4"]);
    expect(ids(reorderElements(page, ["e1", "e2"], "front"))).toEqual(["e0", "e3", "e4", "e1", "e2"]);
  });

  it("moves a single member only inside its group", () => {
    const page = grouped();

    expect(ids(reorderElements(page, ["e1"], "forward"))).toEqual(["e0", "e2", "e1", "e3", "e4"]);
    expect(reorderElements(page, ["e2"], "forward")).toBe(page);
    expect(reorderElements(page, ["e1"], "backward")).toBe(page);
    expect(ids(reorderElements(page, ["e1"], "front"))).toEqual(["e0", "e2", "e1", "e3", "e4"]);
  });

  it("places dragged layers but never inside a group they do not belong to", () => {
    const page = grouped();

    expect(ids(placeElements(page, ["e4"], 0))).toEqual(["e4", "e0", "e1", "e2", "e3"]);
    expect(ids(placeElements(page, ["e0"], 3))).toEqual(["e1", "e2", "e0", "e3", "e4"]);
    expect(ids(placeElements(page, ["e4"], 2))).toEqual(["e0", "e4", "e1", "e2", "e3"]);
    expect(ids(placeElements(page, ["e1", "e2"], 5))).toEqual(["e0", "e3", "e4", "e1", "e2"]);
    expect(placeElements(page, ["e0"], 0)).toBe(page);
    expect(placeElements(page, ["missing"], 3)).toBe(page);
  });

  it("keeps a dragged member inside its own group", () => {
    const page = grouped();

    expect(ids(placeElements(page, ["e1"], 3))).toEqual(["e0", "e2", "e1", "e3", "e4"]);
    expect(ids(placeElements(page, ["e1"], 5))).toEqual(["e0", "e2", "e1", "e3", "e4"]);
    expect(ids(placeElements(page, ["e2"], 0))).toEqual(["e0", "e2", "e1", "e3", "e4"]);
  });

  it("duplicates part of a group as loose elements", () => {
    const page = grouped();

    const copy = duplicateElements(page, ["e1"], 5);

    expect(copy.page.elements.at(-1)?.groupId).toBeNull();
    expect(duplicateElements({ ...page, elements: [at(page, "e1") as StudioPage["elements"][number]] }, ["e1"], 0).page.elements.at(-1)?.groupId).toBeNull();
  });
});

describe("page size changes", () => {
  it("keeps the content where it is by default", () => {
    const page = pageWith([10, 20, 30, 40]);

    const wider = resizePage(page, 800, 400, "keep");

    expect(wider).toMatchObject({ width: 800, height: 400 });
    expect(wider.elements[0]).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("scales the content proportionally and centres it on the new page", () => {
    const page = createPage(200, 100);
    page.elements = [
      { ...createShape("rect", 0, 0, 200, 100, { stroke: { color: "#000000", width: 2, dash: "solid" }, cornerRadius: 4 }), id: "box" },
      { ...createText(50, 25, 100, 50, "Hi", { fontSize: 20 }), id: "text" },
    ];

    const scaled = resizePage(page, 400, 400, "scale");

    expect(at(scaled, "box")).toMatchObject({ x: 0, y: 100, width: 400, height: 200, cornerRadius: 8, stroke: { width: 4 } });
    expect(at(scaled, "text")).toMatchObject({ x: 100, y: 150, width: 200, height: 100, fontSize: 40 });
  });

  it("clamps the size and leaves an unchanged page alone", () => {
    const page = pageWith([0, 0, 10, 10]);

    expect(resizePage(page, 500, 400, "scale")).toBe(page);
    expect(resizePage(page, 1, Number.NaN, "keep")).toMatchObject({ width: 18, height: 18 });
  });

  it("applies one size to every page in a single change", () => {
    let design = createDesign("Deck", 100, 100);
    design = addPage(design, null).design;
    design = { ...design, pages: [design.pages[0], { ...design.pages[1], width: 300, height: 300 }] };

    const resized = resizeAllPages(design, 300, 300, "keep");

    expect(resized.pages.map((page) => [page.width, page.height])).toEqual([[300, 300], [300, 300]]);
    expect(resized.pages[1]).toBe(design.pages[1]);
    expect(resizeAllPages(resized, 300, 300, "scale")).toBe(resized);
  });
});
