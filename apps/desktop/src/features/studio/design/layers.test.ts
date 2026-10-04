import { afterEach, describe, expect, it } from "vitest";
import type { StudioPage } from "@/types/studio";
import { createDesign, createPage, createShape } from "../model/design";
import { groupElements } from "../model/edit";
import { dropSide, moveIndex } from "./dragSort";
import { layerRows, layerSource, resolveLayerDrop, type LayerRow } from "./layerRows";
import { useStudioStore } from "./studioStore";

function grouped(): StudioPage {
  const page = createPage(500, 400);
  page.elements = [0, 1, 2, 3, 4].map((index) => ({ ...createShape("rect", index * 20, 0, 10, 10), id: `e${index}` }));
  return groupElements(page, ["e1", "e2"]).page;
}

const keys = (rows: LayerRow[]) => rows.map((row) => (row.kind === "group" ? "group" : row.key));

describe("layer rows", () => {
  it("lists the top layer first and folds a group into one row until opened", () => {
    const page = grouped();

    expect(keys(layerRows(page, () => false))).toEqual(["e4", "e3", "group", "e0"]);
    const open = layerRows(page, () => true);
    expect(keys(open)).toEqual(["e4", "e3", "group", "e2", "e1", "e0"]);
    expect(open.filter((row) => row.kind === "element" && row.member).map((row) => row.key)).toEqual(["e2", "e1"]);
  });

  it("drops a loose layer beside a group, never between its members", () => {
    const page = grouped();
    const rows = layerRows(page, () => true);
    const source = layerSource(rows[0]);

    expect(resolveLayerDrop(page, rows, source, { key: "e2", side: "after" })).toMatchObject({ side: "before", index: 3 });
    expect(resolveLayerDrop(page, rows, source, { key: "e1", side: "after" })).toMatchObject({ key: "e1", side: "after", index: 1 });
    expect(resolveLayerDrop(page, rows, source, { key: "e0", side: "after" })).toMatchObject({ index: 0 });
    expect(resolveLayerDrop(page, rows, source, { key: "e3", side: "before" })).toBeNull();
    expect(resolveLayerDrop(page, rows, source, { key: "missing", side: "before" })).toBeNull();
  });

  it("keeps a dragged member inside its group", () => {
    const page = grouped();
    const rows = layerRows(page, () => true);
    const member = rows.find((row) => row.key === "e1") as LayerRow;
    const source = layerSource(member);

    expect(source).toEqual({ ids: ["e1"], groupId: page.elements[1].groupId });
    expect(resolveLayerDrop(page, rows, source, { key: "e2", side: "before" })).toMatchObject({ key: "e2", index: 3 });
    expect(resolveLayerDrop(page, rows, source, { key: "e4", side: "before" })).toMatchObject({ key: "e2", side: "before" });
    expect(resolveLayerDrop(page, rows, source, { key: "e0", side: "after" })).toBeNull();
  });
});

describe("drag helpers", () => {
  const rect = { left: 0, top: 0, width: 100, height: 20 };

  it("picks the side of the row under the pointer", () => {
    expect(dropSide(rect, 10, 5, "y")).toBe("before");
    expect(dropSide(rect, 10, 15, "y")).toBe("after");
    expect(dropSide(rect, 80, 5, "x")).toBe("after");
    expect(dropSide(rect, 80, 5, "x", true)).toBe("before");
  });

  it("turns a drop beside another item into a new index", () => {
    expect(moveIndex(0, 2, "after")).toBe(2);
    expect(moveIndex(3, 1, "before")).toBe(1);
    expect(moveIndex(1, 1, "after")).toBeNull();
    expect(moveIndex(1, 2, "before")).toBeNull();
  });
});

describe("entering a group", () => {
  afterEach(() => useStudioStore.getState().close());

  function open() {
    const design = createDesign("Card", 500, 400);
    useStudioStore.getState().open({ ...design, pages: [grouped()] });
  }

  it("selects the whole group until a member is entered", () => {
    open();
    const store = useStudioStore.getState();

    store.select(["e1"]);
    expect(useStudioStore.getState().selection).toEqual(["e1", "e2"]);

    store.enterGroup("e2");
    expect(useStudioStore.getState().selection).toEqual(["e2"]);
    store.select(["e1"]);
    expect(useStudioStore.getState().selection).toEqual(["e1"]);
  });

  it("leaves the group when something outside it or the whole group is chosen", () => {
    open();
    const store = useStudioStore.getState();

    store.enterGroup("e1");
    store.select(["e0", "e1"]);
    expect(useStudioStore.getState()).toMatchObject({ selection: ["e0", "e1", "e2"], groupScope: null });

    store.enterGroup("e1");
    store.exitGroup();
    expect(useStudioStore.getState()).toMatchObject({ selection: ["e1", "e2"], groupScope: null });
  });

  it("treats a loose element as a normal selection", () => {
    open();

    useStudioStore.getState().enterGroup("e0");
    expect(useStudioStore.getState()).toMatchObject({ selection: ["e0"], groupScope: null });
    useStudioStore.getState().enterGroup("missing");
    expect(useStudioStore.getState().selection).toEqual(["e0"]);
  });
});
