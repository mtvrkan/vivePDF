import { describe, expect, it } from "vitest";
import type { TableSettings } from "@/features/viewer/overlay/table/tableModel";
import type { PresentationInsertedItem } from "@/types";
import { MAX_SOURCE_BYTES, drawingOfInserted, insertedItemAt, insertedSourceOf } from "./insertedSource";

const settings = { cells: [["Name"]], align: ["left"] } as unknown as TableSettings;

function item(fields: Partial<PresentationInsertedItem>): PresentationInsertedItem {
  return { id: "a", kind: "table", data: { settings, width: 10, height: 5 }, rect: [0, 0, 0.5, 0.5], ...fields };
}

describe("insertedSourceOf", () => {
  it("keeps a table's settings and size but not its picture", () => {
    const source = insertedSourceOf({ kind: "table", source: { settings, svg: "<svg/>", width: 10, height: 5 } });

    expect(source).toEqual({ kind: "table", data: { settings, width: 10, height: 5 } });
  });

  it("stores nothing for other kinds or a source over the size limit", () => {
    const huge = { cells: [["x".repeat(MAX_SOURCE_BYTES)]], align: ["left"] } as unknown as TableSettings;

    const sources = [insertedSourceOf({ kind: "formula", source: { latex: "x", svg: "<svg/>", color: "#000000", emWidth: 1, emHeight: 1 } }), insertedSourceOf({ kind: "table", source: { settings: huge, svg: "", width: 1, height: 1 } })];

    expect(sources).toEqual([null, null]);
  });
});

describe("drawingOfInserted", () => {
  it("rebuilds the editor source and finds the topmost stamp under a point", () => {
    const items = [item({ id: "low" }), item({ id: "top" })];

    const hit = insertedItemAt(items, { x: 0.2, y: 0.2 });

    expect(hit?.id).toBe("top");
    expect(drawingOfInserted(items[0])).toEqual({ kind: "table", source: { settings, svg: "", width: 10, height: 5 } });
    expect(insertedItemAt(items, { x: 0.8, y: 0.2 })).toBeNull();
  });

  it("refuses a malformed source", () => {
    const broken = [item({ data: { settings, width: 0, height: 5 } }), item({ data: { settings: { cells: "x" }, width: 1, height: 1 } }), item({ kind: "chart", data: { settings: {}, width: 1, height: 1 } })];

    expect(broken.map(drawingOfInserted)).toEqual([null, null, null]);
  });
});
