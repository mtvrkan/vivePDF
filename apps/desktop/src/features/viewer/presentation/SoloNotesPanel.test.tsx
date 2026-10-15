import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";

const readNotes = vi.hoisted(() => vi.fn());
const scroll = vi.hoisted(() => ({ currentPage: 2, totalPages: 4 }));

vi.mock("@/features/presenter/presenterNotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/presenter/presenterNotes")>()),
  readNotes,
  writeNotes: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ state: scroll, provides: null }) }));

const { SoloNotesPanel } = await import("./SoloNotesPanel");

describe("solo presentation notes", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    readNotes.mockReset().mockResolvedValue({ 1: "Second page note", 2: "Third page note" });
    useDocumentStore.setState({ activeId: "d", documents: { d: { path: "C:/talks/deck.pdf" } } } as never);
    usePresentationStore.getState().resetSession();
  });

  afterEach(() => {
    cleanup();
    useDocumentStore.setState({ documents: {}, activeId: null });
  });

  it("stays hidden until notes are switched on", () => {
    render(<SoloNotesPanel documentId="d" />);

    expect(screen.queryByTestId("solo-notes")).toBeNull();
    expect(readNotes).not.toHaveBeenCalled();
  });

  it("shows the note of the page on screen from the document's notes file", async () => {
    act(() => usePresentationStore.getState().toggleNotes());
    render(<SoloNotesPanel documentId="d" />);

    expect(await screen.findByDisplayValue("Second page note")).toBeTruthy();
    expect(readNotes).toHaveBeenCalledWith("C:/talks/deck.pdf");
  });

  it("closes again when the presentation session ends", () => {
    act(() => usePresentationStore.getState().toggleNotes());
    render(<SoloNotesPanel documentId="d" />);

    act(() => usePresentationStore.getState().resetSession());

    expect(screen.queryByTestId("solo-notes")).toBeNull();
  });
});
