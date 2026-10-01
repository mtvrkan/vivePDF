import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "@/shared/store/toastStore";
import { clipTiles, clippedSourcePaths, pastedTiles, usePageClipboard } from "./pageClipboard";
import { tileKey, useOrganizerStore } from "./organizerStore";
import { useInsertSources } from "./useInsertSources";
import type { OrganizerEdits } from "./useOrganizerEdits";

export function usePageClipboardActions(edits: Pick<OrganizerEdits, "deleteSelected" | "insertAtSelection">) {
  const { t } = useTranslation();
  const pushToast = useToastStore((state) => state.push);
  const setClipboard = usePageClipboard((state) => state.setTiles);
  const { loadPdfSource, imageTiles } = useInsertSources();
  const { deleteSelected, insertAtSelection } = edits;
  const [pasting, setPasting] = useState(false);

  const copyPages = useCallback(() => {
    const state = useOrganizerStore.getState();
    if (state.selected.size === 0) return false;
    setClipboard(clipTiles(state.tiles, state.selected, state.sources));
    pushToast("info", t("tools.pages.clipboard.copied"));
    return true;
  }, [setClipboard, pushToast, t]);

  const cutPages = useCallback(() => {
    if (copyPages()) deleteSelected();
  }, [copyPages, deleteSelected]);

  const pastePages = useCallback(async () => {
    const clipped = usePageClipboard.getState().tiles;
    if (clipped.length === 0 || pasting) return;
    setPasting(true);
    try {
      const sourceIdByPath = new Map<string, string>();
      let missing = false;
      for (const source of clippedSourcePaths(clipped)) {
        const load = await loadPdfSource(source.path, source.password);
        if (load.status === "ready") sourceIdByPath.set(source.path, load.source.id);
        else if (load.status === "password") missing = true;
      }
      const imagePaths = [...new Set(clipped.flatMap((tile) => (tile.kind === "image" ? [tile.path] : [])))];
      const previews = await imageTiles(imagePaths);
      const previewByPath = new Map(previews.map((tile) => [tile.kind === "image" ? tile.path : "", tile.kind === "image" ? tile.previewUrl : ""]));
      const tiles = pastedTiles(clipped, sourceIdByPath, previewByPath, tileKey);
      for (const url of previewByPath.values()) if (url && !tiles.some((tile) => tile.kind === "image" && tile.previewUrl === url)) URL.revokeObjectURL(url);
      if (missing) pushToast("error", t("tools.pages.clipboard.sourceMissing"));
      if (tiles.length > 0) insertAtSelection(tiles);
    } finally {
      setPasting(false);
    }
  }, [pasting, loadPdfSource, imageTiles, insertAtSelection, pushToast, t]);

  return { copyPages, cutPages, pastePages, pasting };
}
