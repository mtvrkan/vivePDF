import { beforeEach, describe, expect, it } from "vitest";
import { COLLECTION_NAME_MAX, nextCollectionColor, readCollections, useCollectionsStore } from "./collectionsStore";

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
    const raw = JSON.stringify([{ id: "1", name: "Ok", color: "pink", paths: ["C:/a.pdf", 4] }, { id: 2, name: "Bad", paths: [] }, "junk"]);

    expect(readCollections(raw)).toEqual([{ id: "1", name: "Ok", color: "blue", paths: ["C:/a.pdf"] }]);
  });

  it("returns nothing for missing or unreadable storage", () => {
    expect(readCollections(null)).toEqual([]);
    expect(readCollections("{not json")).toEqual([]);
  });
});

describe("nextCollectionColor", () => {
  it("cycles through the colours once all are taken", () => {
    const taken = ["blue", "green", "orange", "purple", "amber", "red"].map((color, index) => ({ id: String(index), name: "", color: color as "blue", paths: [] }));

    expect(nextCollectionColor(taken)).toBe("blue");
  });
});
