import { beforeEach, describe, expect, it } from "vitest";
import { useViewerOverlayStore, type BlockRun, type EditorPending } from "./viewerOverlayStore";
import { styleUnchanged } from "@/features/viewer/overlay/pending";
import { toClipboardObject, useEditorClipboard } from "@/features/viewer/overlay/editorClipboard";
import { useDocumentStore } from "./documentStore";

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

function copy(object: EditorPending, documentId = "doc", path = "C:/docs/source.pdf") {
  const copied = toClipboardObject(object, { documentId, path, password: null, imagePreviews: useViewerOverlayStore.getState().imagePreviews });
  useEditorClipboard.getState().setEntry(copied ? { object: copied, documentId, pageIndex: object.pageIndex, systemText: null } : null);
}

describe("viewerOverlayStore paste", () => {
  beforeEach(() => {
    useViewerOverlayStore.setState({ objects: [], past: [], future: [] });
    useEditorClipboard.setState({ entry: null, pasteRequest: null });
  });

  it("pastes a paragraph as a text object that keeps every run style", () => {
    const store = useViewerOverlayStore.getState();
    copy(block());
    store.pasteObject("doc", 1, 600, 800);
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
    copy(source);
    store.pasteObject("doc", 0, 600, 800);
    const pasted = useViewerOverlayStore.getState().objects[0];
    if (pasted.kind !== "text" || !pasted.runs) throw new Error("expected runs");
    pasted.runs[0].text = "changed";
    expect(source.runs[0].text).toBe("Normal ");
  });

  it("applies a whole-object style change to the pasted runs too", () => {
    const store = useViewerOverlayStore.getState();
    copy(block());
    store.pasteObject("doc", 0, 600, 800);
    const pasted = useViewerOverlayStore.getState().objects[0];
    store.setSelectedObject(pasted.id);
    store.setTextStyle({ color: "#ff0000" });
    const updated = useViewerOverlayStore.getState().objects[0];
    if (updated.kind !== "text") throw new Error("expected text");
    expect(updated.style.color).toBe("#ff0000");
    expect(updated.runs?.every((run) => run.color === "#ff0000")).toBe(true);
  });
});

describe("viewerOverlayStore duplicate and paste of pictures", () => {
  const imageChange: EditorPending = { id: "i1", kind: "imageChange", pageIndex: 0, x: 10, y: 10, width: 100, height: 50, blockId: "img0", xref: 7, original: { x: 10, y: 10, width: 100, height: 50 }, deleted: false, aspect: 2, aspectLocked: true, replacement: null, rotate: 0, flipH: false, flipV: false, opacity: 1, placementRotation: 0 };

  beforeEach(() => {
    useViewerOverlayStore.setState({ objects: [], past: [], future: [], imagePreviews: {} });
    useEditorClipboard.setState({ entry: null, pasteRequest: null });
  });

  it("duplicates a paragraph as a new text object, not a second claim on the same block", () => {
    useViewerOverlayStore.getState().duplicateObject("doc", block());
    const [copy] = useViewerOverlayStore.getState().objects;
    expect(copy.kind).toBe("text");
    expect(copy.id).not.toBe("b1");
    expect(useViewerOverlayStore.getState().past).toHaveLength(1);
  });

  it("duplicates an untouched page picture only when its preview is known", () => {
    useViewerOverlayStore.getState().duplicateObject("doc", imageChange);
    expect(useViewerOverlayStore.getState().objects).toHaveLength(0);
    expect(useViewerOverlayStore.getState().past).toHaveLength(0);
    useViewerOverlayStore.setState({ imagePreviews: { "doc:0:7": "data:image/png;base64,AA" } });
    useViewerOverlayStore.getState().duplicateObject("doc", imageChange);
    const [copy] = useViewerOverlayStore.getState().objects;
    expect(copy.kind).toBe("image");
  });

  it("skips pasting a picture without a preview", () => {
    const store = useViewerOverlayStore.getState();
    copy(imageChange);
    store.pasteObject("doc", 0, 600, 800);
    expect(useViewerOverlayStore.getState().objects).toHaveLength(0);
  });
});

describe("viewerOverlayStore paste across documents", () => {
  beforeEach(() => {
    useViewerOverlayStore.setState({ objects: [], past: [], future: [], imagePreviews: {} });
    useEditorClipboard.setState({ entry: null, pasteRequest: null });
    useDocumentStore.getState().register("source", "C:/docs/source.pdf", null);
    useDocumentStore.getState().register("target", "C:/docs/target.pdf", null);
  });

  it("keeps a copied object after the editing session ends", () => {
    copy(block(), "source");

    useViewerOverlayStore.getState().setMode(null);
    useViewerOverlayStore.getState().pasteObject("target", 0, 600, 800);

    expect(useViewerOverlayStore.getState().objects).toHaveLength(1);
  });

  it("carries the source document's fonts into another document", () => {
    copy(block(), "source");

    const pasted = useViewerOverlayStore.getState().pasteObject("target", 0, 600, 800);

    expect(pasted?.kind === "text" && pasted.fontSource?.path).toBe("C:/docs/source.pdf");
    expect(pasted?.kind === "text" && pasted.runs?.map((run) => run.fontXref)).toEqual([5, 5]);
  });

  it("drops the font source when pasting back into the same file", () => {
    copy(block(), "source");

    const pasted = useViewerOverlayStore.getState().pasteObject("source", 0, 600, 800);

    expect(pasted?.kind === "text" && pasted.fontSource).toBeUndefined();
  });

  it("places a paste at the requested point inside the page", () => {
    copy(block(), "source");

    const pasted = useViewerOverlayStore.getState().pasteObject("target", 2, 600, 800, { x: 590, y: 50 });

    expect(pasted && [pasted.pageIndex, pasted.x, pasted.y]).toEqual([2, 400, 50]);
  });
});

describe("viewerOverlayStore discarding", () => {
  it("drops undo history when leaving an editor mode for a page tool", () => {
    const store = useViewerOverlayStore.getState();
    store.setMode("text");
    store.snapshot();
    store.addObject(block());
    const token = useViewerOverlayStore.getState().sessionToken;
    store.setMode("crop");
    const after = useViewerOverlayStore.getState();
    expect(after.objects).toHaveLength(0);
    expect(after.past).toHaveLength(0);
    expect(after.future).toHaveLength(0);
    expect(after.sessionToken).toBeGreaterThan(token);
    store.setMode(null);
  });

  it("keeps undo history when moving between text and picture editing", () => {
    const store = useViewerOverlayStore.getState();
    store.setMode("text");
    store.snapshot();
    store.setMode("image");
    expect(useViewerOverlayStore.getState().past).toHaveLength(1);
    store.setMode(null);
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
