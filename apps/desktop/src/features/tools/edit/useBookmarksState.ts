import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { joinPath, outputDirectoryFor, stemOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { getBookmarks, parseBookmarks, suggestBookmarks } from "@/shared/rpc/operations";
import type { BookmarkItem, SourceDocument, ToastKind } from "@/types";
import { moveBookmarkBranch, serializeBookmarks, setAllCollapsed, sortBookmarksByPage, withPage } from "./bookmarkTree";
import type { Tab } from "./editShared";

export function useBookmarksState(source: SourceDocument | null, tab: Tab, t: TFunction, toast: (kind: ToastKind, message: string) => void) {
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkOpenPanel, setBookmarkOpenPanel] = useState(false);
  const [bookmarkItems, setBookmarkItems] = useState<BookmarkItem[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarksGenerating, setBookmarksGenerating] = useState(false);
  const [bookmarkLevels, setBookmarkLevels] = useState(3);
  const [bookmarkEvery, setBookmarkEvery] = useState(10);
  const bookmarksRequest = useRef(0);

  const loadBookmarks = useCallback(async () => {
    if (!source?.info) return;
    const request = ++bookmarksRequest.current;
    setBookmarksLoading(true);
    setBookmarksLoaded(false);
    try {
      const result = await getBookmarks({ path: source.path, password: source.password ?? undefined });
      if (request !== bookmarksRequest.current) return;
      setBookmarkItems(result.items);
      setBookmarksLoaded(true);
    } catch (error) {
      if (request !== bookmarksRequest.current) return;
      const rpcError = toRpcError(error);
      toast("error", describeError(t, rpcError));
    } finally {
      if (request === bookmarksRequest.current) setBookmarksLoading(false);
    }
  }, [source, t, toast]);

  useEffect(() => {
    if (tab === "bookmarks" && source?.info) void loadBookmarks();
  }, [tab, source?.path, source?.info, loadBookmarks]);

  const handleGenerateBookmarks = async () => {
    if (!source) return;
    setBookmarksGenerating(true);
    try {
      const result = await suggestBookmarks({ path: source.path, password: source.password ?? undefined, maxLevels: bookmarkLevels });
      setBookmarkItems(result.items);
      toast("success", t("tools.edit.bookmarks.loadedIntoList", { count: result.items.length }));
    } catch (error) {
      const rpcError = toRpcError(error);
      toast("error", describeError(t, rpcError));
    } finally {
      setBookmarksGenerating(false);
    }
  };

  const handleGenerateEveryPage = async () => {
    if (!source) return;
    setBookmarksGenerating(true);
    try {
      const result = await suggestBookmarks({
        path: source.path,
        password: source.password ?? undefined,
        mode: "everyPage",
        every: bookmarkEvery,
        label: t("tools.edit.bookmarks.everyLabel"),
      });
      setBookmarkItems(result.items);
      toast("success", t("tools.edit.bookmarks.loadedIntoList", { count: result.items.length }));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBookmarksGenerating(false);
    }
  };

  const handleExportBookmarks = async () => {
    if (!source) return;
    const chosen = await saveDialog({ defaultPath: joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}.json`), filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof chosen !== "string") return;
    setBookmarksGenerating(true);
    try {
      const target = /\.json$/i.test(chosen) ? chosen : `${chosen}.json`;
      await invoke("write_text_file", { path: target, contents: serializeBookmarks(bookmarkItems) });
      toast("success", t("tools.edit.bookmarks.exported", { count: bookmarkItems.length }));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBookmarksGenerating(false);
    }
  };

  const handleImportBookmarks = async () => {
    if (!source) return;
    const chosen = await openDialog({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof chosen !== "string") return;
    setBookmarksGenerating(true);
    try {
      const result = await parseBookmarks({ path: source.path, password: source.password ?? undefined, dataPath: chosen });
      setBookmarkItems(result.items);
      toast("success", t("tools.edit.bookmarks.loadedIntoList", { count: result.items.length }));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBookmarksGenerating(false);
    }
  };

  const addBookmark = () => setBookmarkItems((state) => [...state, { level: 1, title: "", page: 1 }]);
  const removeBookmark = (index: number) => setBookmarkItems((state) => state.filter((_, i) => i !== index));
  const updateBookmark = (index: number, patch: Partial<BookmarkItem>) =>
    setBookmarkItems((state) =>
      state.map((item, i) => {
        if (i !== index) return item;
        const { page, ...rest } = patch;
        const updated = { ...item, ...rest };
        return page === undefined ? updated : withPage(updated, page);
      }),
    );
  const sortBookmarks = () => setBookmarkItems((state) => sortBookmarksByPage(state));
  const collapseBookmarks = (collapsed: boolean) => setBookmarkItems((state) => setAllCollapsed(state, collapsed));
  const toggleBookmark = (index: number) =>
    setBookmarkItems((state) => state.map((item, i) => (i === index ? { ...item, collapsed: !item.collapsed } : item)));
  const indentBookmark = (index: number) =>
    setBookmarkItems((state) => state.map((item, i) => (i === index ? { ...item, level: item.level + 1 } : item)));
  const outdentBookmark = (index: number) =>
    setBookmarkItems((state) => state.map((item, i) => (i === index && item.level > 1 ? { ...item, level: item.level - 1 } : item)));
  const moveBookmark = (index: number, delta: number) => setBookmarkItems((state) => moveBookmarkBranch(state, index, delta));
  const bookmarkPageCount = source?.info?.pageCount ?? 0;

  return {
    bookmarksLoaded,
    bookmarkOpenPanel,
    setBookmarkOpenPanel,
    bookmarkItems,
    bookmarksLoading,
    bookmarksGenerating,
    bookmarkLevels,
    setBookmarkLevels,
    bookmarkEvery,
    setBookmarkEvery,
    handleGenerateBookmarks,
    handleGenerateEveryPage,
    handleExportBookmarks,
    handleImportBookmarks,
    addBookmark,
    removeBookmark,
    updateBookmark,
    sortBookmarks,
    collapseBookmarks,
    toggleBookmark,
    indentBookmark,
    outdentBookmark,
    moveBookmark,
    bookmarkPageCount,
  };
}
