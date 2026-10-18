import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { FormulaSource } from "@/features/viewer/overlay/formula/formulaSvg";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import type { PresentationInsertedItem } from "@/types";

const rpc = vi.hoisted(() => ({ sources: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ presentationInsertedSources: rpc.sources }));

const { MAX_DRAWING_DATA_URL, editPresentationDrawing, editSavedPresentationDrawing, openPresentationDrawing } = await import("./drawingInsert");

const FORMULA: FormulaSource = { latex: "x^2", svg: "<svg/>", color: "#111111", emWidth: 2, emHeight: 1 };
const DRAWING = { kind: "formula" as const, source: FORMULA };

function finishHost(patch: { dataUrl: string; width: number; height: number }) {
  const overlay = useViewerOverlayStore.getState();
  overlay.setPendingImage({ ...patch, path: null, drawing: DRAWING });
  overlay.closeDrawingEditor();
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  useViewerOverlayStore.getState().setMode(null);
  useViewerOverlayStore.setState({ objects: [], past: [], future: [] });
  useToastStore.setState({ toasts: [] });
});

describe("openPresentationDrawing", () => {
  it("opens the editor and turns its result into an item waiting to be placed", () => {
    openPresentationDrawing("formula");
    expect(useViewerOverlayStore.getState().drawingEditor).toEqual({ kind: "formula", objectId: null });

    finishHost({ dataUrl: "data:image/svg+xml,a", width: 36, height: 18 });

    const presentation = usePresentationStore.getState();
    const asset = presentation.placing ? presentation.drawingAssets[presentation.placing.asset] : undefined;
    expect(asset).toEqual({ dataUrl: "data:image/svg+xml,a", width: 36, height: 18, drawing: DRAWING });
    expect(presentation.tool).toBe("select");
    expect(useViewerOverlayStore.getState().pendingImage).toBeNull();
    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });

  it("refuses an oversized result with a message instead of placing it", () => {
    openPresentationDrawing("formula");

    finishHost({ dataUrl: "x".repeat(MAX_DRAWING_DATA_URL + 1), width: 36, height: 18 });

    expect(usePresentationStore.getState().placing).toBeNull();
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["error"]);
  });

  it("stays out of the way while the page editor is open", () => {
    useViewerOverlayStore.getState().setMode("text");

    openPresentationDrawing("formula");

    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });
});

describe("editPresentationDrawing", () => {
  function placed(): Stroke {
    const asset = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:old", width: 40, height: 20, drawing: DRAWING });
    const stroke: Stroke = { id: "drawing-1", tool: "drawing", color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], size: { width: 0.2, height: 0.1 }, asset };
    usePresentationStore.getState().addStroke(0, stroke);
    return stroke;
  }

  it("hands the item to its editor and writes the edited picture back", () => {
    const stroke = placed();
    const before = useViewerOverlayStore.getState().past;

    editPresentationDrawing(0, stroke);
    const request = useViewerOverlayStore.getState().drawingEditor;
    expect(request?.kind).toBe("formula");
    const proxy = useViewerOverlayStore.getState().objects.find((item) => item.id === request?.objectId);
    expect(proxy).toMatchObject({ kind: "image", width: 40, height: 20, drawing: DRAWING });

    const overlay = useViewerOverlayStore.getState();
    overlay.snapshot();
    overlay.updateObject(request?.objectId ?? "", { dataUrl: "data:new", width: 80, height: 20, drawing: DRAWING } as Partial<EditorPending>);
    overlay.closeDrawingEditor();

    const next = usePresentationStore.getState().strokesByPage[0][0];
    expect(next.asset).not.toBe(stroke.asset);
    expect(usePresentationStore.getState().drawingAssets[next.asset ?? ""].dataUrl).toBe("data:new");
    expect(next.size?.width).toBeCloseTo(0.4);
    expect(next.size?.height).toBeCloseTo(0.1);
    expect(useViewerOverlayStore.getState().objects).toEqual([]);
    expect(useViewerOverlayStore.getState().past).toBe(before);
  });

  it("leaves the item as it was when the editor is closed without changes", () => {
    const stroke = placed();

    editPresentationDrawing(0, stroke);
    useViewerOverlayStore.getState().closeDrawingEditor();

    expect(usePresentationStore.getState().strokesByPage[0]).toEqual([stroke]);
    expect(useViewerOverlayStore.getState().objects).toEqual([]);
  });

  it("writes an edited board item back to its board", () => {
    const asset = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:old", width: 40, height: 20, drawing: DRAWING });
    const stroke: Stroke = { id: "board-item", tool: "drawing", color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], size: { width: 0.2, height: 0.1 }, asset };
    usePresentationStore.getState().addBoardStroke("white", stroke);

    editPresentationDrawing("white", stroke);
    const request = useViewerOverlayStore.getState().drawingEditor;
    const overlay = useViewerOverlayStore.getState();
    overlay.snapshot();
    overlay.updateObject(request?.objectId ?? "", { dataUrl: "data:new", width: 40, height: 40, drawing: DRAWING } as Partial<EditorPending>);
    overlay.closeDrawingEditor();

    const next = usePresentationStore.getState().boardStrokes.white[0];
    expect(usePresentationStore.getState().drawingAssets[next.asset ?? ""].dataUrl).toBe("data:new");
    expect(next.size?.height).toBeCloseTo(0.2);
    expect(usePresentationStore.getState().strokesByPage).toEqual({});
  });

  it("does nothing for an item whose picture is unknown", () => {
    const stroke: Stroke = { id: "drawing-2", tool: "drawing", color: "#000000", width: 0, points: [{ x: 0, y: 0 }], size: { width: 0.1, height: 0.1 }, asset: "missing" };

    editPresentationDrawing(0, stroke);

    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });
});

describe("editSavedPresentationDrawing", () => {
  const settings = { cells: [["Name", "City"]], align: ["left", "left"] };
  const saved: PresentationInsertedItem = { id: "vivepdf-drawing-1", kind: "table", data: { settings, width: 100, height: 50 }, rect: [0.2, 0.3, 0.6, 0.5] };

  function stamps(exists = true) {
    return { path: "/docs/talk.pdf", exists: vi.fn(() => exists), remove: vi.fn() };
  }

  beforeEach(() => {
    rpc.sources.mockReset();
    rpc.sources.mockResolvedValue({ items: [saved] });
  });

  it("opens the saved table in its editor and replaces the stamp with an editable item in the same box", async () => {
    const target = stamps();
    const edited = { kind: "table" as const, source: { settings, svg: "<svg/>", width: 200, height: 50 } };

    const opened = await editSavedPresentationDrawing(1, { x: 0.4, y: 0.4 }, target);
    const request = useViewerOverlayStore.getState().drawingEditor;
    const proxy = useViewerOverlayStore.getState().objects.find((item) => item.id === request?.objectId);
    const overlay = useViewerOverlayStore.getState();
    overlay.updateObject(request?.objectId ?? "", { dataUrl: "data:new", width: 200, height: 50, drawing: edited } as Partial<EditorPending>);
    overlay.closeDrawingEditor();

    expect(opened).toBe(true);
    expect(rpc.sources).toHaveBeenCalledWith({ path: "/docs/talk.pdf", password: undefined, page: 2 });
    expect(request?.kind).toBe("table");
    expect(proxy).toMatchObject({ width: 100, height: 50, drawing: { kind: "table", source: { settings, width: 100, height: 50 } } });
    const [stroke] = usePresentationStore.getState().strokesByPage[1];
    expect(stroke.points[0]).toEqual({ x: 0.2, y: 0.3 });
    expect(stroke.size?.width).toBeCloseTo(0.8);
    expect(stroke.size?.height).toBeCloseTo(0.2);
    expect(usePresentationStore.getState().drawingAssets[stroke.asset ?? ""].drawing).toEqual(edited);
    expect(stroke.replaces).toBe("vivepdf-drawing-1");
    expect(target.remove).toHaveBeenCalledWith(1, "vivepdf-drawing-1");
    expect(useViewerOverlayStore.getState().objects).toEqual([]);
  });

  it("leaves the stamp alone when the editor is closed without changes", async () => {
    const target = stamps();

    await editSavedPresentationDrawing(1, { x: 0.4, y: 0.4 }, target);
    useViewerOverlayStore.getState().closeDrawingEditor();

    expect(target.remove).not.toHaveBeenCalled();
    expect(usePresentationStore.getState().strokesByPage[1]).toBeUndefined();
  });

  it("does nothing for an old stamp without a source, a click beside it or a stamp already removed", async () => {
    rpc.sources.mockResolvedValueOnce({ items: [] });

    const results = [await editSavedPresentationDrawing(1, { x: 0.4, y: 0.4 }, stamps()), await editSavedPresentationDrawing(1, { x: 0.9, y: 0.9 }, stamps()), await editSavedPresentationDrawing(1, { x: 0.4, y: 0.4 }, stamps(false))];

    expect(results).toEqual([false, false, false]);
    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });

  it("finds a stamp moved but not saved yet at its new place and puts the edit there", async () => {
    const target = { ...stamps(), rectOf: vi.fn(() => [0.5, 0.6, 0.9, 0.8] as [number, number, number, number]) };

    const besideOld = await editSavedPresentationDrawing(1, { x: 0.3, y: 0.35 }, target);
    const opened = await editSavedPresentationDrawing(1, { x: 0.7, y: 0.7 }, target);
    const request = useViewerOverlayStore.getState().drawingEditor;
    const overlay = useViewerOverlayStore.getState();
    overlay.updateObject(request?.objectId ?? "", { dataUrl: "data:new", width: 100, height: 50, drawing: { kind: "table", source: { settings, svg: "<svg/>", width: 100, height: 50 } } } as Partial<EditorPending>);
    overlay.closeDrawingEditor();

    expect([besideOld, opened]).toEqual([false, true]);
    expect(target.rectOf).toHaveBeenCalledWith("vivepdf-drawing-1");
    expect(usePresentationStore.getState().strokesByPage[1][0].points[0]).toEqual({ x: 0.5, y: 0.6 });
  });

  it("shows an error when the stamps cannot be read", async () => {
    rpc.sources.mockRejectedValueOnce({ code: "FILE_NOT_FOUND", message: "gone" });

    const opened = await editSavedPresentationDrawing(1, { x: 0.4, y: 0.4 }, stamps());

    expect(opened).toBe(false);
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["error"]);
  });
});
