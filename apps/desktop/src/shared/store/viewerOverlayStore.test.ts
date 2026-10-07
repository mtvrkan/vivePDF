import { beforeEach, describe, expect, it } from "vitest";
import { useViewerOverlayStore, type BlockRun, type EditorPending } from "./viewerOverlayStore";
import { styleUnchanged } from "@/features/viewer/overlay/pending";

const PLAIN = { font: "Helvetica", fontXref: 5, size: 12, color: "#111111", bold: false, italic: false, superscript: false };
const BOLD = { ...PLAIN, bold: true };
const RUNS: BlockRun[] = [
  { ...PLAIN, text: "Normal " },
  { ...BOLD, text: "kalın" },
];

function block(overrides: Partial<Extract<EditorPending, { kind: "block" }>> = {}): Extract<EditorPending, { kind: "block" }> {
  const style = { fontSize: 12, color: "#111111", bold: false, italic: false, font: "Helvetica", align: "left" as const, lineHeight: 1.2 };
  return {
    id: "b1",
    kind: "block",
    pageIndex: 0,
    x: 10,
    y: 10,
    width: 200,
    height: 30,
    text: "Normal kalın",
    original: "Normal kalın",
    originalRect: { x: 10, y: 10, width: 200, height: 30 },
    blockId: "t0",
    style,
    originalStyle: { ...style },
    fontXref: 5,
    fontExt: "ttf",
    fontFamily: "Helvetica",
    runs: RUNS.map((run) => ({ ...run })),
    originalRuns: RUNS.map((run) => ({ ...run })),
    firstLineIndent: 0,
    leading: 0,
    rotated: false,
    fittedSize: null,
    opacity: 1,
    ...overrides,
  };
}

describe("viewerOverlayStore paste", () => {
  beforeEach(() => {
    useViewerOverlayStore.setState({ objects: [], clipboard: null, past: [], future: [] });
  });

  it("pastes a paragraph as a text object that keeps every run style", () => {
    const store = useViewerOverlayStore.getState();
    store.copyObject(block());
    store.pasteObject(1, 600, 800);
    const pasted = useViewerOverlayStore.getState().objects[0];
    expect(pasted.kind).toBe("text");
    if (pasted.kind !== "text") return;
    expect(pasted.pageIndex).toBe(1);
    expect(pasted.runs?.map((run) => [run.text, run.bold])).toEqual([
      ["Normal ", false],
      ["kalın", true],
    ]);
  });

  it("copies the runs so editing the paste leaves the source alone", () => {
    const source = block();
    const store = useViewerOverlayStore.getState();
    store.copyObject(source);
    store.pasteObject(0, 600, 800);
    const pasted = useViewerOverlayStore.getState().objects[0];
    if (pasted.kind !== "text" || !pasted.runs) throw new Error("expected runs");
    pasted.runs[0].text = "changed";
    expect(source.runs[0].text).toBe("Normal ");
  });

  it("applies a whole-object style change to the pasted runs too", () => {
    const store = useViewerOverlayStore.getState();
    store.copyObject(block());
    store.pasteObject(0, 600, 800);
    const pasted = useViewerOverlayStore.getState().objects[0];
    store.setSelectedObject(pasted.id);
    store.setTextStyle({ color: "#ff0000" });
    const updated = useViewerOverlayStore.getState().objects[0];
    if (updated.kind !== "text") throw new Error("expected text");
    expect(updated.style.color).toBe("#ff0000");
    expect(updated.runs?.every((run) => run.color === "#ff0000")).toBe(true);
  });
});

describe("styleUnchanged", () => {
  it("is true for an untouched paragraph", () => {
    expect(styleUnchanged(block())).toBe(true);
  });

  it("notices a per-run style change even when the block style is the same", () => {
    expect(styleUnchanged(block({ runs: [{ ...PLAIN, text: "Normal kalın" }] }))).toBe(false);
  });

  it("ignores text edits that keep the original styles", () => {
    expect(styleUnchanged(block({ text: "Normal çok kalın", runs: [{ ...PLAIN, text: "Normal çok " }, { ...BOLD, text: "kalın" }] }))).toBe(true);
  });
});

describe("viewerOverlayStore measurements", () => {
  beforeEach(() => {
    useViewerOverlayStore.setState({ mode: "measure", measure: null, measurements: [] });
  });

  it("keeps every finished measurement instead of replacing the last one", () => {
    const store = useViewerOverlayStore.getState();
    store.addMeasurePoint(0, { x: 0, y: 0 });
    store.addMeasurePoint(0, { x: 10, y: 0 });
    store.addMeasurePoint(0, { x: 0, y: 5 });
    store.addMeasurePoint(0, { x: 0, y: 25 });
    const state = useViewerOverlayStore.getState();
    expect(state.measure).toBeNull();
    expect(state.measurements.map(({ a, b }) => [a, b])).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 0, y: 5 }, { x: 0, y: 25 }],
    ]);
  });

  it("restarts an unfinished measurement when the second click lands on another page", () => {
    const store = useViewerOverlayStore.getState();
    store.addMeasurePoint(0, { x: 0, y: 0 });
    store.addMeasurePoint(1, { x: 4, y: 4 });
    const state = useViewerOverlayStore.getState();
    expect(state.measure).toEqual({ pageIndex: 1, points: [{ x: 4, y: 4 }] });
    expect(state.measurements).toEqual([]);
  });

  it("undoes the open point first, then finished measurements, and removes or clears them on request", () => {
    const store = useViewerOverlayStore.getState();
    store.addMeasurePoint(0, { x: 0, y: 0 });
    store.addMeasurePoint(0, { x: 1, y: 0 });
    store.addMeasurePoint(0, { x: 2, y: 0 });
    store.addMeasurePoint(0, { x: 3, y: 0 });
    store.addMeasurePoint(0, { x: 9, y: 9 });
    store.undoMeasure();
    expect(useViewerOverlayStore.getState().measure).toBeNull();
    expect(useViewerOverlayStore.getState().measurements).toHaveLength(2);
    store.undoMeasure();
    expect(useViewerOverlayStore.getState().measurements.map(({ b }) => b.x)).toEqual([1]);
    store.addMeasurePoint(0, { x: 5, y: 5 });
    store.addMeasurePoint(0, { x: 6, y: 6 });
    store.removeMeasurement(useViewerOverlayStore.getState().measurements[0].id);
    expect(useViewerOverlayStore.getState().measurements.map(({ b }) => b.x)).toEqual([6]);
    store.resetMeasure();
    expect(useViewerOverlayStore.getState().measurements).toEqual([]);
  });

  it("drops measurements when the tool closes", () => {
    const store = useViewerOverlayStore.getState();
    store.addMeasurePoint(0, { x: 0, y: 0 });
    store.addMeasurePoint(0, { x: 1, y: 1 });
    store.setMode(null);
    expect(useViewerOverlayStore.getState().measurements).toEqual([]);
  });
});
