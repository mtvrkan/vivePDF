import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { applyPatch, diffSlice, presentationFields, sharedSlice, type SharedSlice } from "./presenterSync";

const stroke = (id: string): Stroke => ({ id, tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });

function slice(overrides: Partial<SharedSlice> = {}): SharedSlice {
  return {
    page: 1,
    blackout: "none",
    strokesByPage: {},
    boardStrokes: { black: [], white: [] },
    laserColor: "#E5484D",
    laserSize: 8,
    spotlightRadius: 180,
    spotlightShape: "circle",
    spotlightDim: 0.78,
    magnifierSize: 220,
    magnifierZoom: 2.5,
    magnifierShape: "circle",
    ...overrides,
  };
}

describe("presenterSync", () => {
  it("sends only the page whose strokes changed and the fields that moved", () => {
    const kept = [stroke("a")];
    const before = slice({ strokesByPage: { 0: kept, 1: [] } });
    const after = slice({ page: 2, strokesByPage: { 0: kept, 1: [stroke("b")] } });

    const patch = diffSlice(before, after);

    expect(patch).toEqual({ page: 2, strokesByPage: { 1: [stroke("b")] } });
    expect(applyPatch(before, { kind: "patch", patch: patch! })).toEqual(after);
  });

  it("clears a page the console dropped and keeps quiet when nothing changed", () => {
    const before = slice({ strokesByPage: { 3: [stroke("a")] } });
    const after = slice({ strokesByPage: {} });

    const patch = diffSlice(before, after);

    expect(patch).toEqual({ strokesByPage: { 3: [] } });
    expect(diffSlice(after, after)).toBeNull();
    expect(diffSlice(slice({ strokesByPage: { 2: [] } }), slice())).toBeNull();
  });

  it("replaces everything on a full snapshot, boards included", () => {
    const before = slice({ strokesByPage: { 0: [stroke("old")] } });
    const snapshot = slice({ blackout: "white", boardStrokes: { black: [], white: [stroke("w")] } });

    expect(applyPatch(before, { kind: "full", slice: snapshot })).toEqual(snapshot);
    expect(diffSlice(before, snapshot)).toMatchObject({ blackout: "white", boardStrokes: snapshot.boardStrokes, strokesByPage: { 0: [] } });
  });

  it("sends a changed text selection and clears it when the selection goes away", () => {
    const marks = { color: "#FFD400", pages: { 0: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] } };
    const before = slice();
    const selected = slice({ selection: marks });

    const added = diffSlice(before, selected);
    const removed = diffSlice(selected, slice({ selection: null }));

    expect(added).toEqual({ selection: marks });
    expect(applyPatch(before, { kind: "patch", patch: added! }).selection).toBe(marks);
    expect(removed).toEqual({ selection: null });
    expect(diffSlice(slice({ selection: null }), slice())).toBeNull();
  });

  it("sends an inserted picture once, then only the item's box when it moves", () => {
    const picture = { dataUrl: "data:image/svg+xml,a", width: 40, height: 20 };
    const item: Stroke = { id: "d", tool: "drawing", color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], size: { width: 0.2, height: 0.1 }, asset: "asset-1" };
    const before = slice();
    const placed = slice({ drawingAssets: { "asset-1": picture }, strokesByPage: { 0: [item] } });
    const moved = slice({ drawingAssets: { "asset-1": picture }, strokesByPage: { 0: [{ ...item, points: [{ x: 0.3, y: 0.3 }] }] } });

    const first = diffSlice(before, placed);
    const second = diffSlice(placed, moved);

    expect(first).toEqual({ drawingAssets: { "asset-1": picture }, strokesByPage: { 0: [item] } });
    expect(second).toEqual({ strokesByPage: moved.strokesByPage });
    expect(applyPatch(applyPatch(before, { kind: "patch", patch: first! }), { kind: "patch", patch: second! })).toEqual(moved);
  });

  it("shares inserted pictures without their editable source and gives the audience an empty set by default", () => {
    usePresentationStore.getState().resetSession();
    const id = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:x", width: 10, height: 5, drawing: { kind: "formula", source: { latex: "x", svg: "<svg/>", color: "#111111", emWidth: 1, emHeight: 1 } } });

    expect(sharedSlice(usePresentationStore.getState(), 1).drawingAssets).toEqual({ [id]: { dataUrl: "data:x", width: 10, height: 5 } });
    expect(presentationFields(slice()).drawingAssets).toEqual({});
  });

  it("sends the ruler as it moves and hands the audience none by default", () => {
    const ruler = { pageIndex: 0, x: 0.1, y: 0.5, angle: 0, pageWidthPt: 600 };
    const before = slice();
    const shown = slice({ ruler });
    const turned = slice({ ruler: { ...ruler, angle: 30 } });

    const first = diffSlice(before, shown);
    const second = diffSlice(shown, turned);
    const hidden = diffSlice(turned, slice({ ruler: null }));

    expect(first).toEqual({ ruler });
    expect(second).toEqual({ ruler: { ...ruler, angle: 30 } });
    expect(hidden).toEqual({ ruler: null });
    expect(presentationFields(applyPatch(before, { kind: "patch", patch: second! })).ruler).toEqual({ ...ruler, angle: 30 });
    expect(presentationFields(slice()).ruler).toBeNull();
  });

  it("mirrors a board undo as plain strokes and leaves the board history with the presenter", () => {
    usePresentationStore.getState().resetSession();
    usePresentationStore.getState().addBoardStroke("black", stroke("a"));
    usePresentationStore.getState().addBoardStroke("black", stroke("b"));
    const drawn = sharedSlice(usePresentationStore.getState(), 1);

    usePresentationStore.getState().undoBoard("black");
    const patch = diffSlice(drawn, sharedSlice(usePresentationStore.getState(), 1));

    expect(patch).toEqual({ boardStrokes: { black: [stroke("a")], white: [] } });
    expect(Object.keys(presentationFields(applyPatch(drawn, { kind: "patch", patch: patch! })))).not.toContain("boardHistory");
    expect(diffSlice(drawn, drawn)).toBeNull();
  });
});
