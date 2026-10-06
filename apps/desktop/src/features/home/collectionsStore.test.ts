import { beforeEach, describe, expect, it } from "vitest";
import { GROUP_COLORS } from "@/features/viewer/tabGroups";
import { COLLECTION_NAME_MAX, moveCollection, nextCollectionColor, pinnedFirst, readCollections, useCollectionsStore, withPinned, type Collection } from "./collectionsStore";

beforeEach(() => {
  useCollectionsStore.setState({ collections: [] });
});

describe("useCollectionsStore", () => {
  it("creates a named collection without duplicate paths and gives each new one the next free colour", () => {
    const first = useCollectionsStore.getState().create("  Contracts  ", ["C:/a.pdf", "c:\\A.pdf", "C:/b.docx"]);
    useCollectionsStore.getState().create("Invoices", ["C:/c.pdf"]);

    const [contracts, invoices] = useCollectionsStore.getState().collections;
    expect(contracts).toEqual({ id: first, name: "Contracts", color: "blue", paths: ["C:/a.pdf", "C:/b.docx"] });
    expect(invoices.color).toBe("green");
  });

  it("renames within the length limit, adds and removes files and deletes a collection", () => {
    const id = useCollectionsStore.getState().create("Draft", ["C:/a.pdf"]);

    useCollectionsStore.getState().rename(id, "x".repeat(80));
    useCollectionsStore.getState().addPaths(id, ["C:/b.pdf", "C:/A.PDF"]);
    useCollectionsStore.getState().removePath(id, "c:/a.pdf");
    const edited = useCollectionsStore.getState().collections[0];
    useCollectionsStore.getState().remove(id);

    expect(edited.name).toHaveLength(COLLECTION_NAME_MAX);
    expect(edited.paths).toEqual(["C:/b.pdf"]);
    expect(useCollectionsStore.getState().collections).toEqual([]);
  });
});

describe("readCollections", () => {
  it("keeps valid stored collections and drops broken entries and unknown colours", () => {
    const raw = JSON.stringify([{ id: "1", name: "Ok", color: "chartreuse", paths: ["C:/a.pdf", 4] }, { id: 2, name: "Bad", paths: [] }, "junk"]);

    expect(readCollections(raw)).toEqual([{ id: "1", name: "Ok", color: "blue", paths: ["C:/a.pdf"] }]);
  });

  it("returns nothing for missing or unreadable storage", () => {
    expect(readCollections(null)).toEqual([]);
    expect(readCollections("{not json")).toEqual([]);
  });
});

describe("nextCollectionColor", () => {
  it("cycles through the colours once all are taken", () => {
    const taken = GROUP_COLORS.map((color, index) => ({ id: String(index), name: "", color, paths: [] }));

    expect(nextCollectionColor(taken)).toBe("blue");
  });
});

const named = (name: string, pinned = false): Collection => (pinned ? { id: name, name, color: "blue", paths: [], pinned: true } : { id: name, name, color: "blue", paths: [] });
const names = (collections: Collection[]) => collections.map((collection) => collection.name);

describe("collection order", () => {
  it("moves a collection to a new place and keeps it inside its pinned or unpinned group", () => {
    const list = [named("A", true), named("B"), named("C"), named("D")];

    expect(names(moveCollection(list, "D", 1))).toEqual(["A", "D", "B", "C"]);
    expect(names(moveCollection(list, "B", 0))).toEqual(["A", "B", "C", "D"]);
    expect(names(moveCollection(list, "A", 3))).toEqual(["A", "B", "C", "D"]);
    expect(moveCollection(list, "missing", 0)).toBe(list);
  });

  it("puts a newly pinned collection after the other pinned ones and an unpinned one first among the rest", () => {
    const list = [named("A", true), named("B"), named("C")];

    const pinned = withPinned(list, "C", true);
    expect(names(pinned)).toEqual(["A", "C", "B"]);
    expect(pinned[1]?.pinned).toBe(true);
    const unpinned = withPinned(pinned, "A", false);
    expect(names(unpinned)).toEqual(["C", "A", "B"]);
    expect("pinned" in (unpinned[1] ?? {})).toBe(false);
  });

  it("shows pinned collections first, reads the pin back from storage and moves and pins in the store", () => {
    expect(names(pinnedFirst([named("A"), named("B", true)]))).toEqual(["B", "A"]);
    expect(readCollections(JSON.stringify([{ id: "1", name: "Kept", color: "blue", paths: [], pinned: true }, { id: "2", name: "Plain", color: "blue", paths: [], pinned: "yes" }]))).toEqual([
      { id: "1", name: "Kept", color: "blue", paths: [], pinned: true },
      { id: "2", name: "Plain", color: "blue", paths: [] },
    ]);
    const store = useCollectionsStore.getState();
    const first = store.create("First", []);
    store.create("Second", []);
    store.move(first, 1);
    store.setPinned(first, true);

    expect(names(useCollectionsStore.getState().collections)).toEqual(["First", "Second"]);
    expect(useCollectionsStore.getState().collections[0]?.pinned).toBe(true);
  });
});

