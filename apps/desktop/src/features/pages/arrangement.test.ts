import { describe, expect, it } from "vitest";
import type { OrganizerSource, OrganizerTile } from "@/types";
import { arrangementOf } from "./arrangement";

const source = (id: string, password: string | null = null): OrganizerSource => ({ id, path: `C:/docs/${id}.pdf`, password, fileName: `${id}.pdf`, embedDocId: null, pageCount: 3 });
const sources = { main: source("main", "secret"), other: source("other"), unused: source("unused") };
const main = { path: "C:/docs/main.pdf", password: "secret" };

const tiles: OrganizerTile[] = [
  { key: "o1", kind: "page", sourceId: "other", index: 2, rotate: 90 },
  { key: "b1", kind: "blank", width: 595, height: 842, rotate: 0, paper: { style: "lined", spacing: 8, color: "#000000" } },
  { key: "m1", kind: "page", sourceId: "main", index: 1, rotate: 0 },
  { key: "i1", kind: "image", path: "C:/pics/a.png", fileName: "a.png", previewUrl: "blob:x", rotate: 180 },
];

describe("arrangementOf", () => {
  it("sends only the sources in use and every page kind in order", () => {
    const arranged = arrangementOf(tiles, sources, main);

    expect(arranged.sources).toEqual([
      { id: "main", path: "C:/docs/main.pdf", password: "secret" },
      { id: "other", path: "C:/docs/other.pdf", password: undefined },
    ]);
    expect(arranged.pages).toEqual([
      { kind: "page", source: "other", index: 2, rotate: 90 },
      { kind: "blank", width: 595, height: 842, rotate: 0, paper: { style: "lined", spacing: 8, color: "#000000" } },
      { kind: "page", source: "main", index: 1, rotate: 0 },
      { kind: "image", path: "C:/pics/a.png", rotate: 180 },
    ]);
  });

  it("falls back to the main file when no page comes from a PDF", () => {
    expect(arrangementOf([tiles[1]], sources, main).sources).toEqual([{ id: "main", path: "C:/docs/main.pdf", password: "secret" }]);
  });

  it("puts the main file first for an in-place write even when none of its pages are kept", () => {
    const reordered = { other: sources.other, main: sources.main };

    expect(arrangementOf(tiles, reordered, main, { mainFirst: true }).sources.map((item) => item.id)).toEqual(["main", "other"]);
    expect(arrangementOf([tiles[0]], { other: sources.other }, main, { mainFirst: true }).sources).toEqual([
      { id: "main", path: "C:/docs/main.pdf", password: "secret" },
      { id: "other", path: "C:/docs/other.pdf", password: undefined },
    ]);
  });
});
