import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookmarkItem, DocumentInfo, SourceDocument } from "@/types";

const { getBookmarks, suggestBookmarks, parseBookmarks } = vi.hoisted(() => ({ getBookmarks: vi.fn(), suggestBookmarks: vi.fn(), parseBookmarks: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({ getBookmarks, suggestBookmarks, parseBookmarks }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { useBookmarksState } from "./useBookmarksState";

const t = ((key: string) => key) as unknown as TFunction;
const OWN: BookmarkItem[] = [{ level: 1, title: "B intro", page: 1 }];
const STALE: BookmarkItem[] = [{ level: 1, title: "A chapter", page: 7 }];

function sourceOf(path: string): SourceDocument {
  return { path, fileName: path, password: null, info: { pageCount: 9 } as DocumentInfo };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  getBookmarks.mockReset();
  suggestBookmarks.mockReset();
});

describe("useBookmarksState", () => {
  it("drops headings generated for a document that was replaced meanwhile", async () => {
    const generated = deferred<{ items: BookmarkItem[] }>();
    getBookmarks.mockImplementation(async ({ path }: { path: string }) => ({ items: path === "b.pdf" ? OWN : [] }));
    suggestBookmarks.mockReturnValue(generated.promise);
    const toast = vi.fn();
    const { result, rerender } = renderHook(({ source }) => useBookmarksState(source, "bookmarks", t, toast), { initialProps: { source: sourceOf("a.pdf") } });
    act(() => void result.current.handleGenerateBookmarks());

    rerender({ source: sourceOf("b.pdf") });
    await waitFor(() => expect(result.current.bookmarkItems).toEqual(OWN));
    await act(async () => generated.resolve({ items: STALE }));

    expect(result.current.bookmarkItems).toEqual(OWN);
    expect(toast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(result.current.bookmarksGenerating).toBe(false);
  });

  it("fills the list with headings generated for the current document", async () => {
    getBookmarks.mockResolvedValue({ items: [] });
    suggestBookmarks.mockResolvedValue({ items: STALE });
    const source = sourceOf("a.pdf");
    const toast = vi.fn();
    const { result } = renderHook(() => useBookmarksState(source, "bookmarks", t, toast));
    await waitFor(() => expect(result.current.bookmarksLoaded).toBe(true));

    await act(async () => result.current.handleGenerateBookmarks());

    expect(result.current.bookmarkItems).toEqual(STALE);
  });

  it("does nothing without a document", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useBookmarksState(null, "bookmarks", t, toast));

    await act(async () => result.current.handleGenerateBookmarks());

    expect(suggestBookmarks).not.toHaveBeenCalled();
  });
});
