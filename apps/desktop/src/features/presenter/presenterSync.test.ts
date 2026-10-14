import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { applyPatch, diffSlice, type SharedSlice } from "./presenterSync";

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
});
