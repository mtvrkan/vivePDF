import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { analyzePages, findDuplicatePages } from "@/shared/rpc/analyze";
import { toRpcError } from "@/shared/rpc/client";
import { detectRotation, findTextPages, getBookmarks } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import { useToastStore } from "@/shared/store/toastStore";
import { defaultOcrLanguages } from "@/app/locales";
import { currentLocale } from "@/app/i18n";
import type { OrganizerSource, RpcError } from "@/types";
import { analyzedTiles, sourcesInUse, withDetectedRotation, type PagesBySource, type RotationsBySource } from "./analyzedSelection";
import { bookmarkCuts, duplicateTiles, imageGroupKey, topLevelStarts, type DuplicateGroups, type PageKeysBySource } from "./organizerTools";
import { useOrganizerStore } from "./organizerStore";
import type { TextQuery } from "./OrganizerDialogs";
import type { OrganizerEdits } from "./useOrganizerEdits";

export type Inspection = "blank" | "scanned" | "rotation" | "bookmarks" | "duplicates" | "text";

export function usePageInspections(activeDocumentId: string | null, edits: Pick<OrganizerEdits, "setCuts" | "selectAndReveal">) {
  const { t } = useTranslation();
  const pushToast = useToastStore((state) => state.push);
  const commit = useOrganizerStore((state) => state.commit);
  const { setCuts, selectAndReveal } = edits;
  const [inspecting, setInspecting] = useState<Inspection | null>(null);
  const inspectionRef = useRef<AbortController | null>(null);

  const cancelInspection = useCallback(() => {
    inspectionRef.current?.abort();
    inspectionRef.current = null;
    setInspecting(null);
  }, []);

  useEffect(() => cancelInspection, [activeDocumentId, cancelInspection]);

  const runInspection = useCallback(
    async <T>(kind: Inspection, task: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> => {
      inspectionRef.current?.abort();
      const controller = new AbortController();
      inspectionRef.current = controller;
      setInspecting(kind);
      try {
        const result = await task(controller.signal);
        return controller.signal.aborted ? null : result;
      } catch (caught) {
        const error = toRpcError(caught);
        if (!controller.signal.aborted && error.code !== "CANCELLED") pushToast("error", describeError(t, error));
        return null;
      } finally {
        if (inspectionRef.current === controller) {
          inspectionRef.current = null;
          setInspecting(null);
        }
      }
    },
    [pushToast, t],
  );

  const inspectSources = useCallback(
    <T>(kind: Inspection, call: (source: OrganizerSource, signal: AbortSignal) => Promise<T>): Promise<Map<string, T> | null> => {
      const state = useOrganizerStore.getState();
      const sourcesToInspect = sourcesInUse(state.tiles)
        .map((id) => state.sources[id])
        .filter((source): source is OrganizerSource => source !== undefined);
      return runInspection(kind, async (signal) => {
        const results = new Map<string, T>();
        let failure: RpcError | null = null;
        for (const source of sourcesToInspect) {
          try {
            results.set(source.id, await call(source, signal));
          } catch (caught) {
            const error = toRpcError(caught);
            if (signal.aborted || error.code === "CANCELLED") return null;
            failure ??= error;
          }
        }
        if (failure && results.size === 0) throw failure;
        return results;
      });
    },
    [runInspection],
  );

  const autoRotateTiles = useCallback(async () => {
    const languages = defaultOcrLanguages(currentLocale());
    const detected = await inspectSources("rotation", (source, signal) =>
      detectRotation({ path: source.path, password: source.password ?? undefined, languages }, { signal }),
    );
    if (!detected) return;
    const rotations: RotationsBySource = {};
    for (const [sourceId, result] of detected) {
      const bySource = new Map<number, number>(result.upright.map((page) => [page, 0]));
      for (const item of result.items) bySource.set(item.page, item.rotation);
      rotations[sourceId] = bySource;
    }
    const outcome = withDetectedRotation(useOrganizerStore.getState().tiles, rotations);
    if (outcome.changed === 0) {
      pushToast("info", t("tools.pages.autoRotateNone"));
      return;
    }
    commit(outcome.tiles);
    pushToast("success", t("tools.pages.autoRotateDone", { count: outcome.changed }));
  }, [inspectSources, commit, pushToast, t]);

  const selectAnalyzed = useCallback(
    async (kind: "blank" | "scanned") => {
      const analyses = await inspectSources(kind, (source, signal) => analyzePages({ path: source.path, password: source.password ?? undefined }, { signal }));
      if (!analyses) return;
      const pages: PagesBySource = {};
      for (const [sourceId, analysis] of analyses) {
        pages[sourceId] = new Set((kind === "blank" ? analysis.blankPages : analysis.scannedPages).map((index) => index + 1));
      }
      const keys = analyzedTiles(useOrganizerStore.getState().tiles, pages, kind === "blank");
      if (keys.length === 0) {
        pushToast("info", t(kind === "blank" ? "tools.pages.blankNone" : "tools.pages.scannedNone"));
        return;
      }
      selectAndReveal(keys);
      pushToast("success", t(kind === "blank" ? "tools.pages.blankFound" : "tools.pages.scannedFound", { count: keys.length }));
    },
    [inspectSources, selectAndReveal, pushToast, t],
  );

  const selectByText = useCallback(
    async ({ query, matchCase, wholeWord, addToSelection }: TextQuery) => {
      const found = await inspectSources("text", (source, signal) =>
        findTextPages({ path: source.path, password: source.password ?? undefined, query, matchCase, wholeWord }, { signal }),
      );
      if (!found) return;
      const pages: PagesBySource = {};
      for (const [sourceId, result] of found) pages[sourceId] = new Set(result.pages);
      const keys = analyzedTiles(useOrganizerStore.getState().tiles, pages, false);
      if (keys.length === 0) {
        pushToast("info", t("tools.pages.textSelect.none"));
        return;
      }
      selectAndReveal(addToSelection ? [...new Set([...keys, ...useOrganizerStore.getState().selected])] : keys);
      pushToast("success", t("tools.pages.textSelect.found", { count: keys.length }));
    },
    [inspectSources, selectAndReveal, pushToast, t],
  );

  const cutAtChapters = useCallback(async () => {
    const outlines = await inspectSources("bookmarks", (source, signal) => getBookmarks({ path: source.path, password: source.password ?? undefined }, { signal }));
    if (!outlines) return;
    const starts: PageKeysBySource = {};
    for (const [sourceId, outline] of outlines) starts[sourceId] = topLevelStarts(outline.items);
    const keys = bookmarkCuts(useOrganizerStore.getState().tiles, starts);
    if (keys.length === 0) {
      pushToast("info", t("tools.pages.chapters.none"));
      return;
    }
    setCuts((current) => new Set([...current, ...keys]));
    pushToast("success", t("tools.pages.chapters.done", { count: keys.length }));
  }, [inspectSources, setCuts, pushToast, t]);

  const selectDuplicates = useCallback(async () => {
    const state = useOrganizerStore.getState();
    const pageSources = sourcesInUse(state.tiles)
      .map((id) => state.sources[id])
      .filter((source): source is OrganizerSource => source !== undefined);
    const imagePaths = [...new Set(state.tiles.flatMap((tile) => (tile.kind === "image" ? [tile.path] : [])))];
    const keys = [...pageSources.map((source) => source.id), ...imagePaths.map(imageGroupKey)];
    const sources = [...pageSources.map((source) => ({ path: source.path, password: source.password ?? undefined })), ...imagePaths.map((path) => ({ path }))];
    const groups: DuplicateGroups | null =
      sources.length === 0
        ? {}
        : await runInspection("duplicates", async (signal) => {
            const result = await findDuplicatePages({ sources }, { signal });
            const bySource: DuplicateGroups = {};
            result.groups.forEach((pageGroups, position) => {
              bySource[keys[position]] = pageGroups;
            });
            return bySource;
          });
    if (!groups) return;
    const duplicates = duplicateTiles(useOrganizerStore.getState().tiles, groups);
    if (duplicates.length === 0) {
      pushToast("info", t("tools.pages.duplicates.none"));
      return;
    }
    selectAndReveal(duplicates);
    pushToast("success", t("tools.pages.duplicates.found", { count: duplicates.length }));
  }, [runInspection, selectAndReveal, pushToast, t]);

  const inspectionButton = (kind: Inspection, run: () => void) => ({
    busy: inspecting === kind,
    disabled: inspecting !== null && inspecting !== kind,
    onClick: inspecting === kind ? cancelInspection : run,
  });

  const runners: Record<Inspection, () => void> = {
    blank: () => void selectAnalyzed("blank"),
    scanned: () => void selectAnalyzed("scanned"),
    rotation: () => void autoRotateTiles(),
    bookmarks: () => void cutAtChapters(),
    duplicates: () => void selectDuplicates(),
    text: () => undefined,
  };

  const inspectionControl = (kind: Inspection, run: () => void = runners[kind]) => inspectionButton(kind, run);

  return { inspecting, inspectionControl, selectByText };
}

export type PageInspections = ReturnType<typeof usePageInspections>;
