import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_ACTIONS,
  defaultHomeLayout,
  dropIndex,
  hiddenSections,
  moveQuickAction,
  moveSection,
  normalizeHomeLayout,
  sectionsIn,
  shiftQuickAction,
  shiftSection,
  updateSection,
  withQuickAction,
  withoutQuickAction,
} from "./homeLayout";

const tools = new Set(["merge", "split", "compress", "ocr", "sign"]);
const ids = (layout: ReturnType<typeof defaultHomeLayout>, region: Parameters<typeof sectionsIn>[1]) => sectionsIn(layout, region).map((section) => section.id);

describe("normalizeHomeLayout", () => {
  it("keeps a valid stored layout and appends sections it does not know about", () => {
    const stored = {
      sections: [
        { id: "stats", region: "top", size: "large", hidden: false },
        { id: "hero", region: "bottom", size: "small", hidden: true },
      ],
      sidebar: { side: "start", width: "wide" },
      quickActions: ["ocr", "sign"],
    };

    const layout = normalizeHomeLayout(stored, tools);

    expect(layout.sections.slice(0, 2)).toEqual([
      { id: "stats", region: "top", size: "large", hidden: false },
      { id: "hero", region: "bottom", size: "small", hidden: true },
    ]);
    expect(layout.sections).toHaveLength(9);
    expect(layout.sidebar).toEqual({ side: "start", width: "wide" });
    expect(layout.quickActions).toEqual(["ocr", "sign"]);
  });

  it("drops unknown sections, duplicates, removed tools and bad values", () => {
    const stored = {
      sections: [{ id: "weather" }, { id: "recent", region: "floating", size: "huge" }, { id: "recent", region: "top" }],
      sidebar: { side: "middle" },
      quickActions: ["merge", "merge", "gone", 5],
    };

    const layout = normalizeHomeLayout(stored, tools);

    expect(layout.sections[0]).toEqual({ id: "recent", region: "main", size: "medium", hidden: false });
    expect(layout.sections.filter((section) => section.id === "recent")).toHaveLength(1);
    expect(layout.sidebar).toEqual({ side: "end", width: "normal" });
    expect(layout.quickActions).toEqual(["merge"]);
    expect(normalizeHomeLayout("nonsense", tools)).toEqual(defaultHomeLayout());
  });
});

describe("moveSection", () => {
  it("moves a section into another region at the given position", () => {
    const layout = moveSection(defaultHomeLayout(), "stats", "main", 1);

    expect(ids(layout, "main")).toEqual(["hero", "stats", "quickActions", "recent", "studio", "collections", "tools"]);
    expect(ids(layout, "side")).toEqual(["continue", "history"]);
  });

  it("appends to the end of a region and shows a hidden section it moves", () => {
    const hidden = updateSection(defaultHomeLayout(), "hero", { hidden: true });

    const layout = moveSection(hidden, "hero", "bottom", 5);

    expect(ids(layout, "bottom")).toEqual(["hero"]);
    expect(hiddenSections(layout)).toEqual([]);
  });

  it("returns the same layout when nothing changes", () => {
    const layout = defaultHomeLayout();

    expect(moveSection(layout, "hero", "main", 0)).toBe(layout);
    expect(moveSection(layout, "hero", "main", 1)).toBe(layout);
  });
});

describe("shiftSection", () => {
  it("swaps a section with its visible neighbour in the same region only", () => {
    const layout = shiftSection(defaultHomeLayout(), "recent", -1);

    expect(ids(layout, "main")).toEqual(["hero", "recent", "quickActions", "studio", "collections", "tools"]);
    expect(ids(shiftSection(layout, "tools", 1), "main")).toEqual(ids(layout, "main"));
    expect(ids(shiftSection(defaultHomeLayout(), "history", 1), "side")).toEqual(["continue", "stats", "history"]);
  });
});

describe("quick actions", () => {
  it("adds once, removes and reorders", () => {
    let layout = withQuickAction(defaultHomeLayout(), "ocr");
    layout = withQuickAction(layout, "ocr");
    layout = withoutQuickAction(layout, "merge");
    layout = shiftQuickAction(layout, "ocr", -1);

    expect(layout.quickActions).toEqual(["split", "compress", "images-to-pdf", "docx", "ocr", "pages"]);
  });

  it("stops at the limit", () => {
    const full = { ...defaultHomeLayout(), quickActions: Array.from({ length: MAX_QUICK_ACTIONS }, (_, index) => `tool-${index}`) };

    expect(withQuickAction(full, "ocr")).toBe(full);
  });
});

describe("moveQuickAction", () => {
  it("puts the tool at the given place and shifts the others", () => {
    const layout = defaultHomeLayout();

    expect(moveQuickAction(layout, "merge", 3).quickActions).toEqual(["split", "compress", "images-to-pdf", "merge", "docx", "pages"]);
    expect(moveQuickAction(layout, "pages", 0).quickActions).toEqual(["pages", "merge", "split", "compress", "images-to-pdf", "docx"]);
  });

  it("clamps the place to the ends of the list", () => {
    const layout = defaultHomeLayout();

    expect(moveQuickAction(layout, "split", 99).quickActions.at(-1)).toBe("split");
    expect(moveQuickAction(layout, "split", -4).quickActions[0]).toBe("split");
  });

  it("leaves the layout alone for an unknown tool or the same place", () => {
    const layout = defaultHomeLayout();

    expect(moveQuickAction(layout, "ocr", 0)).toBe(layout);
    expect(moveQuickAction(layout, "compress", 2)).toBe(layout);
  });
});

describe("dropIndex", () => {
  it("finds the slot before the first section whose middle is below the pointer", () => {
    expect(dropIndex([100, 300, 500], 50)).toBe(0);
    expect(dropIndex([100, 300, 500], 320)).toBe(2);
    expect(dropIndex([100, 300, 500], 900)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});
