import { beforeEach, describe, expect, it } from "vitest";
import { clampSplitRatio, rememberSplitPage, splitPageOf, splitViewOf, useSplitViewStore } from "./splitViewStore";

const PATH = "C:/docs/split.pdf";
const OTHER = "C:/docs/other.pdf";

beforeEach(() => {
  useSplitViewStore.setState({ views: {}, revisions: {}, lastLayout: "columns" });
});

describe("splitViewStore", () => {
  it("opens a layout per file and remembers it for the shortcut", () => {
    useSplitViewStore.getState().open(PATH, "rows");
    expect(splitViewOf(useSplitViewStore.getState(), PATH)).toEqual({ layout: "rows", ratio: 0.5, secondary: null, syncScroll: false });

    useSplitViewStore.getState().toggle(PATH);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)).toBeNull();

    useSplitViewStore.getState().toggle(PATH);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.layout).toBe("rows");
  });

  it("keeps the ratio between the limits and ignores closed files", () => {
    useSplitViewStore.getState().setRatio(PATH, 0.3);
    expect(useSplitViewStore.getState().views).toEqual({});

    useSplitViewStore.getState().open(PATH, "columns");
    useSplitViewStore.getState().setRatio(PATH, 0.95);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.ratio).toBe(0.8);
    useSplitViewStore.getState().setRatio(PATH, -1);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.ratio).toBe(0.2);
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
  });

  it("counts saves so the pane reopens the file", () => {
    useSplitViewStore.getState().refresh(PATH);
    useSplitViewStore.getState().refresh(PATH);
    expect(useSplitViewStore.getState().revisions[PATH]).toBe(2);
  });

  it("opens a second document beside the file and keeps its password", () => {
    const store = useSplitViewStore.getState();

    store.openWith(PATH, { path: OTHER, password: "secret" }, "rows");

    expect(splitViewOf(useSplitViewStore.getState(), PATH)).toEqual({ layout: "rows", ratio: 0.5, secondary: { path: OTHER, password: "secret" }, syncScroll: false });
    expect(useSplitViewStore.getState().lastLayout).toBe("rows");
  });

  it("treats the file itself as the same document and keeps the secondary on a layout change", () => {
    const store = useSplitViewStore.getState();
    store.openWith(PATH, { path: PATH, password: null }, "columns");
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.secondary).toBeNull();

    store.setSecondary(PATH, { path: OTHER, password: null });
    store.open(PATH, "rows");

    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.secondary).toEqual({ path: OTHER, password: null });
    store.setSecondary(PATH, null);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.secondary).toBeNull();
  });

  it("toggles synced scrolling and ignores closed files", () => {
    const store = useSplitViewStore.getState();
    store.toggleSync(PATH);
    store.setSecondary(PATH, { path: OTHER, password: null });
    expect(useSplitViewStore.getState().views).toEqual({});

    store.open(PATH, "columns");
    store.toggleSync(PATH);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.syncScroll).toBe(true);
    store.toggleSync(PATH);
    expect(splitViewOf(useSplitViewStore.getState(), PATH)?.syncScroll).toBe(false);
  });

  it("counts saves of the second document under its own path", () => {
    useSplitViewStore.getState().openWith(PATH, { path: OTHER, password: null }, "columns");

    useSplitViewStore.getState().refresh(OTHER);

    expect(useSplitViewStore.getState().revisions).toEqual({ [OTHER]: 1 });
  });

  it("remembers the last page of a pane and starts at page 1", () => {
    expect(splitPageOf("C:/docs/other.pdf")).toBe(1);
    rememberSplitPage(PATH, 4);
    rememberSplitPage(PATH, 0);
    expect(splitPageOf(PATH)).toBe(4);
  });
});
