import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { splitViewOf, useSplitViewStore } from "@/shared/store/splitViewStore";
import type { SplitDocumentState } from "./useSplitDocument";

const pane = vi.hoisted(() => ({ state: { documentId: null, status: "loading", error: null } as SplitDocumentState }));
const dialog = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("./useSplitDocument", () => ({ useSplitDocument: () => pane.state }));
vi.mock("./useSyncedScroll", () => ({ useSyncedScroll: vi.fn() }));
vi.mock("./useRestoredSplitPage", () => ({ useRestoredSplitPage: vi.fn() }));
vi.mock("../PageView", () => ({ PageView: () => null }));
vi.mock("../useUnsavedMarks", () => ({ useUnsavedMarks: () => false }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ provides: null, state: { totalPages: 0, currentPage: 1 } }) }));
vi.mock("@embedpdf/plugin-search/react", () => ({ useSearch: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-selection/react", () => ({ useSelectionCapability: () => ({ provides: null }) }));

const { SplitReadPane } = await import("./SplitReadPane");

const MAIN = "C:/docs/main.pdf";
const OTHER = "C:/docs/other.pdf";

function Pane() {
  const view = useSplitViewStore((state) => splitViewOf(state, MAIN));
  if (!view) return null;
  return (
    <SplitReadPane
      primaryId="a"
      primaryPath={MAIN}
      path={view.secondary?.path ?? MAIN}
      password={view.secondary?.password ?? null}
      separate={view.secondary !== null}
      syncScroll={view.syncScroll}
      pageColors="normal"
    />
  );
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  pane.state = { documentId: null, status: "loading", error: null };
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register("a", MAIN, null);
  useDocumentStore.getState().register("b", OTHER, "pw");
  useSplitViewStore.setState({ views: {}, revisions: {}, lastLayout: "columns" });
  useSplitViewStore.getState().open(MAIN, "columns");
});

afterEach(cleanup);

describe("SplitReadPane", () => {
  it("lists the other open documents and shows the chosen one", () => {
    render(<Pane />);

    fireEvent.click(screen.getByRole("button", { name: "Document in the second pane: main.pdf" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "other.pdf" }));

    expect(splitViewOf(useSplitViewStore.getState(), MAIN)?.secondary).toEqual({ path: OTHER, password: "pw" });
  });

  it("offers the same document and a file chooser", () => {
    useSplitViewStore.getState().setSecondary(MAIN, { path: OTHER, password: "pw" });
    render(<Pane />);

    fireEvent.click(screen.getByRole("button", { name: "Document in the second pane: other.pdf" }));

    expect(screen.getByRole("menuitem", { name: "Choose a file…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Same document" }));
    expect(splitViewOf(useSplitViewStore.getState(), MAIN)?.secondary).toBeNull();
  });

  it("toggles synced scrolling with aria-pressed", () => {
    render(<Pane />);
    const toggle = screen.getByRole("button", { name: "Sync scrolling" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Sync scrolling" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for the password of a locked second document instead of the generic error", () => {
    pane.state = { documentId: null, status: "error", error: { code: "NEEDS_PASSWORD", message: "locked" } };
    useSplitViewStore.getState().setSecondary(MAIN, { path: "C:/docs/locked.pdf", password: null });
    render(<Pane />);

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(splitViewOf(useSplitViewStore.getState(), MAIN)?.secondary).toEqual({ path: "C:/docs/locked.pdf", password: "secret" });
  });
});
