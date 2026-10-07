import { describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { imagePageSize, orientationOf, paperOf, sizeGroups, tileSize, tilesInOrientation, type KnownSizes } from "./pageShapes";

const A4 = { width: 595.28, height: 841.89, rotation: 0 };
const LETTER_WIDE = { width: 792, height: 612, rotation: 90 };

const known: KnownSizes = {
  pages: new Map([["main", [A4, LETTER_WIDE, { width: 596, height: 842, rotation: 0 }]]]),
  images: new Map([["photo.jpg", { width: 400, height: 300 }]]),
};

const tiles: OrganizerTile[] = [
  { key: "p1", kind: "page", sourceId: "main", index: 1, rotate: 0 },
  { key: "p2", kind: "page", sourceId: "main", index: 2, rotate: 0 },
  { key: "p3", kind: "page", sourceId: "main", index: 3, rotate: 90 },
  { key: "b1", kind: "blank", width: 612, height: 792, rotate: 0 },
  { key: "i1", kind: "image", path: "photo.jpg", fileName: "photo.jpg", previewUrl: "", rotate: 0 },
  { key: "i2", kind: "image", path: "unknown.png", fileName: "unknown.png", previewUrl: "", rotate: 0 },
  { key: "x1", kind: "page", sourceId: "inserted", index: 1, rotate: 0 },
];

describe("page shapes", () => {
  it("turns the size of a quarter-rotated tile and leaves unknown sizes out", () => {
    expect(tileSize(tiles[2], known)).toEqual({ width: 842, height: 596 });
    expect(tileSize({ ...tiles[2], rotate: 180 } as OrganizerTile, known)).toEqual({ width: 596, height: 842 });
    expect(tileSize(tiles[3], known)).toEqual({ width: 612, height: 792 });
    expect(tileSize(tiles[5], known)).toBeNull();
    expect(tileSize(tiles[6], known)).toBeNull();
  });

  it("selects pages by how they will look after rotation", () => {
    expect(tilesInOrientation(tiles, known, "portrait")).toEqual(["p1", "b1"]);
    expect(tilesInOrientation(tiles, known, "landscape")).toEqual(["p2", "p3", "i1"]);
    expect(orientationOf({ width: 500, height: 500.4 })).toBe("square");
  });

  it("groups sizes within two points in either orientation and names the paper", () => {
    const groups = sizeGroups(tiles, known);

    expect(groups.map((group) => [group.paper, group.keys])).toEqual([
      ["a4", ["p1", "p3"]],
      ["letter", ["p2", "b1"]],
      [null, ["i1"]],
    ]);
    expect(paperOf({ width: 1008, height: 612 })).toBe("legal");
    expect(paperOf({ width: 600, height: 800 })).toBeNull();
  });

  it("fits a picture into an A4 page the way the engine does", () => {
    expect(imagePageSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
    expect(imagePageSize({ width: 3000, height: 1500 })).toEqual({ width: 842, height: 421 });
    expect(imagePageSize({ width: 1190, height: 1684 })).toEqual({ width: 595, height: 842 });
  });
});
