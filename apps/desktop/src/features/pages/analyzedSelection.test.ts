import { describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { analyzedTiles, sourcesInUse, withDetectedRotation } from "./analyzedSelection";

function page(index: number, sourceId = "main", rotate: OrganizerTile["rotate"] = 0): OrganizerTile {
  return { key: `${sourceId}-${index}`, kind: "page", sourceId, index, rotate };
}

const blank: OrganizerTile = { key: "blank", kind: "blank", width: 595, height: 842, rotate: 0 };
const image: OrganizerTile = { key: "image", kind: "image", path: "a.png", fileName: "a.png", previewUrl: "", rotate: 0 };

describe("sourcesInUse", () => {
  it("lists every document a page comes from once", () => {
    expect(sourcesInUse([page(1), page(2), page(1, "second"), blank, image])).toEqual(["main", "second"]);
  });

  it("is empty when no page comes from a document", () => {
    expect(sourcesInUse([blank, image])).toEqual([]);
  });
});

describe("analyzedTiles", () => {
  it("follows a page that was dragged elsewhere", () => {
    expect(analyzedTiles([page(3), page(1), page(2)], { main: new Set([3]) }, false)).toEqual(["main-3"]);
  });

  it("matches pages of an inserted document by that document", () => {
    const tiles = [page(1), page(1, "second"), page(2, "second")];
    expect(analyzedTiles(tiles, { main: new Set(), second: new Set([2]) }, false)).toEqual(["second-2"]);
  });

  it("counts inserted blank pages only when asked", () => {
    const tiles = [page(1), blank, image];
    expect(analyzedTiles(tiles, { main: new Set([1]) }, true)).toEqual(["main-1", "blank"]);
    expect(analyzedTiles(tiles, { main: new Set([1]) }, false)).toEqual(["main-1"]);
  });

  it("finds nothing when a document was not analysed", () => {
    expect(analyzedTiles([page(1, "second")], {}, false)).toEqual([]);
  });
});

describe("withDetectedRotation", () => {
  it("sets the detected angle instead of adding to a hand-made turn", () => {
    const result = withDetectedRotation([page(1, "main", 90), page(2)], { main: new Map([[1, 180], [2, 0]]) });
    expect(result.changed).toBe(1);
    expect(result.tiles.map((tile) => tile.rotate)).toEqual([180, 0]);
  });

  it("puts a page turned by hand back upright when the text reads upright", () => {
    const result = withDetectedRotation([page(1, "main", 270)], { main: new Map([[1, 0]]) });
    expect(result.tiles[0].rotate).toBe(0);
  });

  it("keeps the same array when nothing changes", () => {
    const tiles = [page(1), blank];
    const result = withDetectedRotation(tiles, { main: new Map([[1, 0]]) });
    expect(result.changed).toBe(0);
    expect(result.tiles).toBe(tiles);
  });

  it("ignores an angle that is not a quarter turn", () => {
    const result = withDetectedRotation([page(1)], { main: new Map([[1, 45]]) });
    expect(result.changed).toBe(0);
  });
});
