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

describe("holdTemporaryDrawings", () => {
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

  it("opens with the save button focused instead of the discard button", () => {
    usePresentationLeftoverStore.getState().hold(leftover());

    render(<PresentationDrawingsPrompt documentId={DOCUMENT_ID} />);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save to the PDF" }));
  });
});
