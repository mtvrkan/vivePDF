import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { getBookmarks } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import type { BookmarkItem } from "@/types";

const DOCUMENT_ID = "doc-outline";
const pdfDocument = { id: DOCUMENT_ID, pageCount: 6 };
const jumpTo = vi.fn();

const registry = { getEngine: () => ({ getBookmarks: () => ({ wait: (done: (result: { bookmarks: [] }) => void) => done({ bookmarks: [] }) }) }) };
const registryState = { registry, documents: { [DOCUMENT_ID]: { document: pdfDocument } } };
const scrollState = { provides: null, state: { currentPage: 2, totalPages: 6 } };

vi.mock("@embedpdf/core/react", () => ({ useRegistry: () => registryState }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => scrollState }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ getBookmarks: vi.fn() }));
vi.mock("@/shared/store/pageLabelsStore", () => ({ usePageLabels: () => null }));
vi.mock("./usePageNavigation", () => ({ usePageNavigation: () => ({ followLink: vi.fn(), jumpTo }) }));

const { OutlinePanel } = await import("./OutlinePanel");

const item = (level: number, title: string, page: number, extra: Partial<BookmarkItem> = {}): BookmarkItem => ({ level, title, page, ...extra });

function pendingItems(): BookmarkItem[] | undefined {
  const change = pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT_ID).find((entry) => entry.kind === "outlineReplaced");
  return change?.kind === "outlineReplaced" ? change.items : undefined;
}

async function renderEditing(items: BookmarkItem[]) {
  vi.mocked(getBookmarks).mockResolvedValue({ items });
  render(<OutlinePanel documentId={DOCUMENT_ID} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit bookmarks" }));
  });
  await screen.findAllByRole("treeitem");
}

function row(title: string): HTMLElement {
  const found = screen.getAllByRole("treeitem").find((entry) => entry.getAttribute("title") === title);
  if (!found) throw new Error(`no row ${title}`);
  return found;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(getBookmarks).mockReset();
  jumpTo.mockReset();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/kitap.pdf", null);
  usePendingChangesStore.setState({ changes: {} });
});

afterEach(cleanup);

describe("OutlinePanel editing", () => {
  it("queues the renamed outline when F2 then Enter commits a new title", async () => {
    await renderEditing([item(1, "Giriş", 1), item(1, "Son", 4, { target: "other", source: 12 })]);

    fireEvent.focus(row("Giriş"));
    fireEvent.keyDown(row("Giriş"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Önsöz" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pendingItems()).toEqual([item(1, "Önsöz", 1), item(1, "Son", 4, { target: "other", source: 12 })]);
  });

  it("refuses an empty title and shows the issue instead of queuing", async () => {
    await renderEditing([item(1, "Giriş", 1)]);

    fireEvent.doubleClick(row("Giriş"));
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pendingItems()).toBeUndefined();
    expect(screen.getByRole("alert").textContent).toContain("needs a title");
  });

  it("deletes a parent with its whole branch on Delete", async () => {
    await renderEditing([item(1, "A", 1), item(2, "A1", 2), item(3, "A1a", 2), item(1, "B", 3)]);

    fireEvent.focus(row("A"));
    fireEvent.keyDown(row("A"), { key: "Delete" });

    expect(pendingItems()?.map((entry) => entry.title)).toEqual(["B"]);
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("indents with Tab and keeps Tab free when the level cannot grow", async () => {
    await renderEditing([item(1, "A", 1), item(1, "B", 2)]);

    fireEvent.focus(row("A"));
    const blocked = fireEvent.keyDown(row("A"), { key: "Tab" });
    fireEvent.focus(row("B"));
    fireEvent.keyDown(row("B"), { key: "Tab" });

    expect(blocked).toBe(true);
    expect(pendingItems()?.map((entry) => entry.level)).toEqual([1, 2]);
    expect(row("B").getAttribute("aria-level")).toBe("2");
  });

  it("merges queued bookmarkAdded changes into the loaded list and drops them", async () => {
    usePendingChangesStore.getState().queue(DOCUMENT_ID, { kind: "bookmarkAdded", title: "Burası", page: 3, y: 50, label: "Burası" });

    await renderEditing([item(1, "A", 1), item(1, "B", 5)]);

    const changes = pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT_ID);
    expect(changes.map((entry) => entry.kind)).toEqual(["outlineReplaced"]);
    expect(pendingItems()?.map((entry) => entry.title)).toEqual(["A", "Burası", "B"]);
  });

  it("adds a bookmark at the current page from the empty state", async () => {
    vi.mocked(getBookmarks).mockResolvedValue({ items: [] });
    render(<OutlinePanel documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit bookmarks" }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add bookmark" }));
    });

    expect(pendingItems()).toEqual([{ level: 1, title: "New bookmark", page: 2, top: null }]);
  });

  it("offers a retry when the editable outline cannot be read", async () => {
    vi.mocked(getBookmarks).mockRejectedValueOnce(new Error("boom"));
    render(<OutlinePanel documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit bookmarks" }));
    });
    vi.mocked(getBookmarks).mockResolvedValue({ items: [item(1, "A", 1)] });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    });

    expect(await screen.findAllByRole("treeitem")).toHaveLength(1);
  });

  it("shows the pending tree in view mode and navigates by page", async () => {
    usePendingChangesStore.getState().replace(DOCUMENT_ID, { kind: "outlineReplaced", items: [item(1, "Bekleyen", 4)], label: "x" });

    render(<OutlinePanel documentId={DOCUMENT_ID} />);
    fireEvent.click(row("Bekleyen"));

    expect(jumpTo).toHaveBeenCalledWith(4);
  });
});
