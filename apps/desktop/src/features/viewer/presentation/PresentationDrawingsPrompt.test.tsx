import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePresentationLeftoverStore, type LeftoverDrawings } from "@/shared/store/presentationLeftoverStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import { holdTemporaryDrawings } from "./leftoverDrawings";
import { PresentationDrawingsPrompt } from "./PresentationDrawingsPrompt";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../useDocumentSave", () => ({ useDocumentSave: () => ({ save: mocks.save }) }));

const DOCUMENT_ID = "doc-present";
const STROKE = { tool: "pen" as const, color: "#ff0000", width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] as [number, number][] };

function leftover(fields: Partial<LeftoverDrawings> = {}): LeftoverDrawings {
  return { documentId: DOCUMENT_ID, finish: "ask", pages: [{ page: 1, strokes: [STROKE] }], boards: [], ...fields };
}

function queued() {
  return pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT_ID);
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(true);
  usePendingChangesStore.getState().clear(DOCUMENT_ID);
  usePresentationLeftoverStore.getState().clear();
  useToastStore.setState({ toasts: [] } as never);
});

afterEach(() => {
  cleanup();
  usePresentationStore.getState().resetSession();
  useDocumentStore.getState().remove(DOCUMENT_ID);
});

describe("PresentationDrawingsPrompt", () => {
  it("asks after the presentation and saves the drawings into the PDF", async () => {
    usePresentationLeftoverStore.getState().hold(leftover({ boards: [{ background: "white", width: 1600, height: 900, strokes: [STROKE] }] }));
    const { container } = render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    expect(screen.getByRole("dialog", { name: "Keep the presentation drawings?" })).toBeTruthy();
    expect(screen.getByText(/Board drawings are added as new pages/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to the PDF" }));
    });

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([expect.objectContaining({ kind: "presentationDrawings", label: "Presentation drawings" })]);
    expect(usePresentationLeftoverStore.getState().leftover).toBeNull();
  });

  it("keeps the drawings as an unsaved change when closed and drops them on discard", () => {
    usePresentationLeftoverStore.getState().hold(leftover());
    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(queued()).toHaveLength(1);
    expect(useToastStore.getState().toasts.some((toast) => toast.kind === "info")).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();

    act(() => usePresentationLeftoverStore.getState().hold(leftover()));
    fireEvent.click(screen.getByRole("button", { name: "Discard drawings" }));

    expect(queued()).toHaveLength(1);
    expect(usePresentationLeftoverStore.getState().leftover).toBeNull();
  });

  it("saves straight away after Finish and ignores drawings of another document", async () => {
    usePresentationLeftoverStore.getState().hold(leftover({ documentId: "other" }));
    const { rerender } = render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      usePresentationLeftoverStore.getState().hold(leftover({ finish: "save" }));
      rerender(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(queued()).toHaveLength(1);
  });
});

describe("PresentationDrawingsPrompt with edited saved items", () => {
  const EDITED = [{ page: 2, strokes: [STROKE] }];

  it("keeps an edited saved table as an unsaved change when the other drawings are discarded", () => {
    usePresentationLeftoverStore.getState().hold(leftover({ edited: EDITED }));
    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard drawings" }));

    expect(queued()).toEqual([expect.objectContaining({ kind: "presentationDrawings", pages: EDITED, boards: [] })]);
    expect(usePresentationLeftoverStore.getState().leftover).toBeNull();
  });

  it("queues an edited saved table without asking when nothing else was drawn", () => {
    usePresentationLeftoverStore.getState().hold(leftover({ pages: [], edited: EDITED }));

    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(queued()).toEqual([expect.objectContaining({ pages: EDITED })]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves the edited table together with the kept drawings", async () => {
    usePresentationLeftoverStore.getState().hold(leftover({ edited: EDITED }));
    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to the PDF" }));
    });

    expect(queued()).toHaveLength(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});

describe("holdTemporaryDrawings", () => {
  it("holds the replacement of an edited saved item apart from the other drawings", () => {
    useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Talk.pdf", null);
    useDocumentStore.setState({ activeId: DOCUMENT_ID } as never);
    const pen = { id: "pen", tool: "pen" as const, color: "#ff0000", width: 0.01, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }] };
    usePresentationStore.setState({ drawingsMode: "temporary", strokesByPage: { 0: [pen], 1: [{ ...pen, id: "replacement", replaces: "vivepdf-drawing-1" }] } });

    holdTemporaryDrawings("ask");

    const held = usePresentationLeftoverStore.getState().leftover;
    expect(held?.pages).toEqual([expect.objectContaining({ page: 1 })]);
    expect(held?.edited).toEqual([expect.objectContaining({ page: 2 })]);
    usePresentationStore.setState({ strokesByPage: {} });
  });

  it("holds temporary drawings of the open document and skips permanent-note sessions", () => {
    useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Talk.pdf", null);
    useDocumentStore.setState({ activeId: DOCUMENT_ID } as never);
    usePresentationStore.setState({ drawingsMode: "temporary", strokesByPage: { 0: [{ id: "a", tool: "pen", color: "#ff0000", width: 0.01, points: [{ x: 0.1, y: 0.1 }] }] } });

    holdTemporaryDrawings("save");

    expect(usePresentationLeftoverStore.getState().leftover).toMatchObject({ documentId: DOCUMENT_ID, finish: "save", pages: [{ page: 1 }], boards: [] });

    usePresentationLeftoverStore.getState().clear();
    usePresentationStore.setState({ drawingsMode: "annotations" });
    holdTemporaryDrawings("ask");
    expect(usePresentationLeftoverStore.getState().leftover).toBeNull();
    usePresentationStore.setState({ drawingsMode: "temporary" });
  });

  it("saves board drawings with the size of the board they were drawn on, not the window", () => {
    useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Talk.pdf", null);
    useDocumentStore.setState({ activeId: DOCUMENT_ID } as never);
    usePresentationStore.setState({ drawingsMode: "temporary", strokesByPage: {}, boardStrokes: { black: [], white: [] }, boardSize: null });
    usePresentationStore.getState().addBoardStroke("black", { id: "b", tool: "pen", color: "#ffffff", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }, { width: 640, height: 360 });

    holdTemporaryDrawings("save");

    expect(usePresentationLeftoverStore.getState().leftover?.boards).toEqual([expect.objectContaining({ background: "black", width: 640, height: 360 })]);
    usePresentationStore.setState({ boardStrokes: { black: [], white: [] }, boardSize: null });
  });

  it("falls back to the window size for boards drawn before a size was known", () => {
    useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Talk.pdf", null);
    useDocumentStore.setState({ activeId: DOCUMENT_ID } as never);
    usePresentationStore.setState({ drawingsMode: "temporary", strokesByPage: {}, boardStrokes: { black: [], white: [{ id: "w", tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.1, y: 0.1 }] }] }, boardSize: null });

    holdTemporaryDrawings("save");

    expect(usePresentationLeftoverStore.getState().leftover?.boards).toEqual([expect.objectContaining({ width: window.innerWidth, height: window.innerHeight })]);
    usePresentationStore.setState({ boardStrokes: { black: [], white: [] } });
  });

  it("keeps only the inserted items of an annotation session, on pages and boards", () => {
    useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Talk.pdf", null);
    useDocumentStore.setState({ activeId: DOCUMENT_ID } as never);
    const asset = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:x", width: 40, height: 20, drawing: { kind: "formula", source: { latex: "x", svg: "<svg/>", color: "#111111", emWidth: 1, emHeight: 1 } } });
    const item = { id: "item", tool: "drawing" as const, color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], size: { width: 0.2, height: 0.1 }, asset };
    const pen = { id: "pen", tool: "pen" as const, color: "#ff0000", width: 0.01, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }] };
    usePresentationStore.setState({ drawingsMode: "annotations", strokesByPage: { 0: [pen, item], 2: [pen] }, boardStrokes: { black: [{ ...item, id: "board-item" }, { ...pen, id: "board-pen" }], white: [] }, boardSize: { width: 800, height: 450 } });

    holdTemporaryDrawings("ask");

    const held = usePresentationLeftoverStore.getState().leftover;
    expect(held?.pages).toEqual([{ page: 1, strokes: [expect.objectContaining({ tool: "drawing" })] }]);
    expect(held?.boards).toEqual([expect.objectContaining({ background: "black", strokes: [expect.objectContaining({ tool: "drawing" })] })]);

    usePresentationLeftoverStore.getState().clear();
    usePresentationStore.setState({ strokesByPage: { 0: [pen] }, boardStrokes: { black: [], white: [] } });
    holdTemporaryDrawings("ask");
    expect(usePresentationLeftoverStore.getState().leftover).toBeNull();
    usePresentationStore.setState({ drawingsMode: "temporary", strokesByPage: {}, boardSize: null });
  });

  it("opens with the save button focused instead of the discard button", () => {
    usePresentationLeftoverStore.getState().hold(leftover());

    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save to the PDF" }));
  });
});
