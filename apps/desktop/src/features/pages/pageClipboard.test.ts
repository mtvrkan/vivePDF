import { describe, expect, it } from "vitest";
import type { OrganizerSource, OrganizerTile } from "@/types";
import { clipTiles, clippedSourcePaths, pastedTiles } from "./pageClipboard";

const sources: Record<string, OrganizerSource> = {
  main: { id: "main", path: "C:/a.pdf", password: "secret", fileName: "a.pdf", embedDocId: "doc-a", pageCount: 3 },
  other: { id: "other", path: "C:/b.pdf", password: null, fileName: "b.pdf", embedDocId: "doc-b", pageCount: 2 },
};

const tiles: OrganizerTile[] = [
  { key: "p1", kind: "page", sourceId: "main", index: 1, rotate: 0 },
  { key: "b1", kind: "blank", width: 595, height: 842, rotate: 90 },
  { key: "p2", kind: "page", sourceId: "other", index: 2, rotate: 180 },
  { key: "i1", kind: "image", path: "C:/pic.png", fileName: "pic.png", previewUrl: "blob:old", rotate: 0 },
  { key: "p3", kind: "page", sourceId: "main", index: 3, rotate: 0 },
];

let counter = 0;
const newKey = () => `k${++counter}`;

describe("clipTiles", () => {
  it("keeps page order and records each page by file path instead of the document-local source id", () => {
    const clipped = clipTiles(tiles, new Set(["p3", "p1", "p2", "b1", "i1"]), sources);
    expect(clipped.map((tile) => tile.kind)).toEqual(["page", "blank", "page", "image", "page"]);
    expect(clipped[0]).toEqual({ kind: "page", source: { path: "C:/a.pdf", password: "secret" }, index: 1, rotate: 0 });
    expect(clippedSourcePaths(clipped).map((source) => source.path)).toEqual(["C:/a.pdf", "C:/b.pdf"]);
  });

  it("skips pages whose source is gone and copies nothing without a selection", () => {
    expect(clipTiles(tiles, new Set(["p1"]), { other: sources.other })).toEqual([]);
    expect(clipTiles(tiles, new Set(), sources)).toEqual([]);
  });
});

describe("pastedTiles", () => {
  it("maps each file to the source id in the target document and gives every tile a new key", () => {
    const clipped = clipTiles(tiles, new Set(["p1", "p2", "i1"]), sources);
    const pasted = pastedTiles(clipped, new Map([["C:/a.pdf", "main"], ["C:/b.pdf", "s-9"]]), new Map([["C:/pic.png", "blob:new"]]), newKey);
    expect(pasted.map((tile) => (tile.kind === "page" ? tile.sourceId : tile.kind))).toEqual(["main", "s-9", "image"]);
    expect(pasted.every((tile) => tile.key.startsWith("k"))).toBe(true);
    expect(pasted[1]).toMatchObject({ index: 2, rotate: 180 });
    expect(pasted[2]).toMatchObject({ previewUrl: "blob:new" });
  });

  it("drops pages whose file could not be loaded", () => {
    const clipped = clipTiles(tiles, new Set(["p1", "b1"]), sources);
    expect(pastedTiles(clipped, new Map(), new Map(), newKey).map((tile) => tile.kind)).toEqual(["blank"]);
  });
});
