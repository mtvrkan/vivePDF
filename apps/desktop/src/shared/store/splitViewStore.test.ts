import { beforeEach, describe, expect, it } from "vitest";
import { clampSplitRatio, rememberSplitPage, splitPageOf, splitViewOf, useSplitViewStore } from "./splitViewStore";

const PATH = "C:/docs/split.pdf";

beforeEach(() => {
  useSplitViewStore.setState({ views: {}, revisions: {}, lastLayout: "columns" });
});

describe("splitViewStore", () => {
  it("opens a layout per file and remembers it for the shortcut", () => {
    useSplitViewStore.getState().open(PATH, "rows");
    expect(splitViewOf(useSplitViewStore.getState(), PATH)).toEqual({ layout: "rows", ratio: 0.5 });

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

  it("remembers the last page of a pane and starts at page 1", () => {
    expect(splitPageOf("C:/docs/other.pdf")).toBe(1);
    rememberSplitPage(PATH, 4);
    rememberSplitPage(PATH, 0);
    expect(splitPageOf(PATH)).toBe(4);
  });
});
