import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { usePresenterStore, type PresenterSession } from "./presenterSession";

const invoke = vi.hoisted(() => vi.fn());
const scroll = vi.hoisted(() => ({ state: { currentPage: 2, totalPages: 5 }, provides: { scrollToNextPage: vi.fn(), scrollToPreviousPage: vi.fn() } }));

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => scroll }));
vi.mock("@embedpdf/core/react", () => ({ useRegistry: () => ({ registry: null, documents: {} }) }));
vi.mock("@/features/viewer/ImmersiveView", () => ({ ImmersiveView: () => <div data-testid="console-stage" /> }));
vi.mock("./usePresenterConsole", () => ({ usePresenterConsole: () => () => undefined }));

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
});
