import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { analyzePages, fingerprintPages } from "@/shared/rpc/analyze";
import { toRpcError } from "@/shared/rpc/client";
import { detectRotation, getBookmarks } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import { useToastStore } from "@/shared/store/toastStore";
import { defaultOcrLanguages } from "@/app/locales";
import { currentLocale } from "@/app/i18n";
import type { OrganizerSource, RpcError } from "@/types";
import { analyzedTiles, sourcesInUse, withDetectedRotation, type PagesBySource, type RotationsBySource } from "./analyzedSelection";
import { bookmarkCuts, duplicateTiles, topLevelStarts, type FingerprintsBySource, type PageKeysBySource } from "./organizerTools";
import { useOrganizerStore } from "./organizerStore";
import type { OrganizerEdits } from "./useOrganizerEdits";

export type Inspection = "blank" | "scanned" | "rotation" | "bookmarks" | "duplicates";

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

  const inspectSources = useCallback(
    async <T>(kind: Inspection, call: (source: OrganizerSource, signal: AbortSignal) => Promise<T>): Promise<Map<string, T> | null> => {
      const state = useOrganizerStore.getState();
      const sourcesToInspect = sourcesInUse(state.tiles)
        .map((id) => state.sources[id])
        .filter((source): source is OrganizerSource => source !== undefined);
      inspectionRef.current?.abort();
      const controller = new AbortController();
      inspectionRef.current = controller;
      setInspecting(kind);
      const results = new Map<string, T>();
      let failure: RpcError | null = null;
      try {
        for (const source of sourcesToInspect) {
          try {
            results.set(source.id, await call(source, controller.signal));
          } catch (caught) {
            const error = toRpcError(caught);
            if (controller.signal.aborted || error.code === "CANCELLED") return null;
            failure ??= error;
          }
        }
        if (controller.signal.aborted) return null;
        if (failure && results.size === 0) {
          pushToast("error", describeError(t, failure));
          return null;
        }
        return results;
      } finally {
        if (inspectionRef.current === controller) {
          inspectionRef.current = null;
          setInspecting(null);
        }
      }
    },
    [pushToast, t],
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
    const results = await inspectSources("duplicates", (source, signal) => fingerprintPages({ path: source.path, password: source.password ?? undefined }, { signal }));
    if (!results) return;
    const fingerprints: FingerprintsBySource = {};
    for (const [sourceId, result] of results) fingerprints[sourceId] = result.fingerprints;
    const keys = duplicateTiles(useOrganizerStore.getState().tiles, fingerprints);
    if (keys.length === 0) {
      pushToast("info", t("tools.pages.duplicates.none"));
      return;
    }
    selectAndReveal(keys);
    pushToast("success", t("tools.pages.duplicates.found", { count: keys.length }));
  }, [inspectSources, selectAndReveal, pushToast, t]);

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
  };

  const inspectionControl = (kind: Inspection) => inspectionButton(kind, runners[kind]);

  return { inspecting, inspectionControl };
}

export type PageInspections = ReturnType<typeof usePageInspections>;
