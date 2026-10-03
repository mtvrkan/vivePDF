import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENT_DESIGNS, readRecentDesigns, RECENT_DESIGNS_KEY, useRecentDesignsStore, type RecentDesign } from "./recentDesigns";

function entry(path: string, name = "Design"): RecentDesign {
  return { path, name, savedAt: 1, width: 100, height: 50, thumbnail: "" };
}

describe("recent designs", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentDesignsStore.setState({ items: [] });
  });

  it("puts the latest design first, once, and keeps it on this computer", () => {
    const store = useRecentDesignsStore.getState();

    store.add(entry("C:\\a.vivedesign", "A"));
    store.add(entry("C:\\b.vivedesign", "B"));
    store.add(entry("c:\\A.vivedesign", "A again"));

    expect(useRecentDesignsStore.getState().items.map((item) => item.name)).toEqual(["A again", "B"]);
    expect(readRecentDesigns().map((item) => item.name)).toEqual(["A again", "B"]);
  });

  it("keeps at most the limit and forgets removed designs", () => {
    for (let index = 0; index < MAX_RECENT_DESIGNS + 3; index += 1) useRecentDesignsStore.getState().add(entry(`C:\\${index}.vivedesign`));

    useRecentDesignsStore.getState().remove(`C:\\${MAX_RECENT_DESIGNS + 2}.vivedesign`);

    expect(useRecentDesignsStore.getState().items).toHaveLength(MAX_RECENT_DESIGNS - 1);
  });

  it("ignores damaged storage and entries with foreign thumbnails", () => {
    localStorage.setItem(RECENT_DESIGNS_KEY, JSON.stringify([entry("C:\\ok.vivedesign"), { ...entry("C:\\x.vivedesign"), thumbnail: "javascript:alert(1)" }, 42]));
    expect(readRecentDesigns().map((item) => item.path)).toEqual(["C:\\ok.vivedesign"]);

    localStorage.setItem(RECENT_DESIGNS_KEY, "{broken");
    expect(readRecentDesigns()).toEqual([]);
  });
});
