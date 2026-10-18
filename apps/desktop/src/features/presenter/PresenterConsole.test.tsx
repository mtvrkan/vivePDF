import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useConvertedStore } from "@/features/viewer/convertedDocuments";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { usePresenterStore, type PresenterSession } from "./presenterSession";

const invoke = vi.hoisted(() => vi.fn());
const scroll = vi.hoisted(() => ({ state: { currentPage: 2, totalPages: 5 }, provides: { scrollToNextPage: vi.fn(), scrollToPreviousPage: vi.fn(), scrollToPage: vi.fn() } }));

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => scroll }));
vi.mock("@embedpdf/core/react", () => ({ useRegistry: () => ({ registry: null, documents: {} }) }));
vi.mock("@/features/viewer/ImmersiveView", () => ({ ImmersiveView: () => <div data-testid="console-stage" /> }));
vi.mock("./usePresenterConsole", () => ({ usePresenterConsole: () => () => undefined }));
const fullscreen = vi.hoisted(() => vi.fn());
vi.mock("@/features/viewer/immersive", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/viewer/immersive")>()), setImmersiveFullscreen: fullscreen }));

const { PresenterConsole } = await import("./PresenterConsole");

function session(overrides: Partial<PresenterSession> = {}): PresenterSession {
  return { documentId: "doc-a", path: "C:/talks/deck.pdf", audience: "present-a", external: true, aspect: 16 / 9, problem: null, ...overrides };
}

function renderConsole() {
  render(<PresenterConsole documentId="doc-a" onExit={() => undefined} />);
}

describe("PresenterConsole", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    scroll.state = { currentPage: 2, totalPages: 5 };
    scroll.provides.scrollToNextPage.mockReset();
    scroll.provides.scrollToPage.mockReset();
    usePresentationStore.getState().resetSession();
    useDocumentStore.getState().register("doc-a", "C:/talks/deck.pdf", null);
    usePresenterStore.setState({ session: session() });
  });

  afterEach(() => {
    cleanup();
    usePresenterStore.setState({ session: null, request: null });
  });

  it("counts pages and advances when the next-page preview is clicked", () => {
    renderConsole();

    expect(screen.getByTestId("presenter-counter").textContent).toContain("2 / 5");
    expect(screen.getByText("Page 2 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next: page 3" }));

    expect(scroll.provides.scrollToNextPage).toHaveBeenCalledTimes(1);
  });

  it("marks the end of the show on the last page", () => {
    scroll.state = { currentPage: 5, totalPages: 5 };

    renderConsole();

    expect(screen.getByText("End of presentation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Next: page/ })).toBeNull();
  });

  it("disables swapping screens while rehearsing on one screen", () => {
    usePresenterStore.setState({ session: session({ external: false }) });

    renderConsole();

    expect((screen.getByRole("button", { name: "Swap screens" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Rehearsal:/)).toBeTruthy();
  });

  it("offers to move a rehearsal onto a projector that was switched to extend", async () => {
    usePresenterStore.setState({ session: session({ external: false }) });
    invoke.mockImplementation(async (command: string) => {
      if (command === "presenter_screens") return 2;
      return command === "presenter_move" ? { label: "present-a", external: true, width: 1920, height: 1080, screens: 2 } : null;
    });
    renderConsole();
    await act(async () => undefined);

    expect(screen.getByText("A second screen is connected now. Move the audience view onto it to present.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move to the projector" })));

    expect(invoke).toHaveBeenCalledWith("presenter_move", undefined);
    expect(fullscreen).toHaveBeenCalledWith(true, 2);
    expect(usePresenterStore.getState().session).toMatchObject({ external: true, aspect: 1920 / 1080 });
    expect(screen.queryByRole("button", { name: "Move to the projector" })).toBeNull();
  });

  it("keeps the rehearsal note while the second screen is still missing", async () => {
    usePresenterStore.setState({ session: session({ external: false }) });
    invoke.mockImplementation(async (command: string) => (command === "presenter_screens" ? 1 : null));
    renderConsole();
    await act(async () => undefined);

    expect(screen.getByText(/Rehearsal:/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to the projector" })).toBeNull();
  });

  it("offers to reopen a closed audience screen on the current page", async () => {
    usePresenterStore.setState({ session: session({ problem: "closed" }) });
    invoke.mockImplementation(async (command: string) => (command === "presenter_open" ? { label: "present-b", external: true, width: 1920, height: 1080 } : null));
    renderConsole();
    expect(screen.getByText("The audience screen was closed.")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reopen" })));

    expect(invoke).toHaveBeenCalledWith("presenter_open", { path: "C:/talks/deck.pdf", password: null, startPage: 1 });
    expect(usePresenterStore.getState().session).toMatchObject({ audience: "present-b", problem: null });
    expect(screen.queryByText("The audience screen was closed.")).toBeNull();
  });

  it("lets the presenter look a few pages ahead without moving the presentation", () => {
    renderConsole();

    fireEvent.click(screen.getByRole("button", { name: "Preview the page after" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview the page after" }));

    expect(screen.getByTestId("presenter-preview-heading").textContent).toBe("Preview: page 5 (only you)");
    expect(scroll.provides.scrollToPage).not.toHaveBeenCalled();
    expect(scroll.provides.scrollToNextPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go to page 5" }));
    expect(scroll.provides.scrollToPage).toHaveBeenCalledWith({ pageNumber: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Back to the next page" }));
    expect(screen.getByTestId("presenter-preview-heading").textContent).toBe("Next page");
  });

  it("stops looking ahead at the last page but can look back from the end", () => {
    scroll.state = { currentPage: 5, totalPages: 5 };
    renderConsole();

    expect((screen.getByRole("button", { name: "Preview the page after" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Preview the page before" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview the page before" }));

    expect(screen.getByTestId("presenter-preview-heading").textContent).toBe("Preview: page 4 (only you)");
  });

  it("keeps the notes of a converted slide deck with the original file, not the temporary PDF", async () => {
    useConvertedStore.getState().remember("C:/Temp/vivepdf-open/deck-1a2b.pdf", "C:/talks/deck.pptx");
    usePresenterStore.setState({ session: session({ path: "C:/Temp/vivepdf-open/deck-1a2b.pdf" }) });
    try {
      renderConsole();
      await act(async () => undefined);

      expect(invoke).toHaveBeenCalledWith("presenter_notes_read", { path: "C:/talks/deck.pptx" });
    } finally {
      useConvertedStore.getState().forget("C:/Temp/vivepdf-open/deck-1a2b.pdf");
    }
  });
});
