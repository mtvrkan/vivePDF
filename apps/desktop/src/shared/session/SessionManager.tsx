import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useOrganizerStore } from "@/features/pages/organizerStore";
import { launchRequest } from "@/shared/rpc/files";
import { hidesOnClose, shouldConfirmClose } from "./closeGuardState";
import { inTabOrder, useDocumentStore } from "@/shared/store/documentStore";
import { savedGroups, useTabGroupStore } from "@/features/viewer/tabGroups";
import { sessionPathOf } from "@/features/viewer/convertedDocuments";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useReportStore } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import type { OrganizerTile, SessionSnapshot } from "@/types";
import { consumePageReload, markCleanExit, markPageReload, markSessionRunning, readStartupSession, wasCleanExit, writeSession } from "./sessionStore";
import { developmentSessionStorage, markStartupHandled, resolveStartupState } from "./startupState";
import { useRestoreSession } from "./useRestoreSession";

const SAVE_DELAY_MS = 600;
const offerStorage = developmentSessionStorage(import.meta.env.DEV);
const startup = resolveStartupState({ readPrevious: readStartupSession, readClean: wasCleanExit, readReloaded: consumePageReload, storage: offerStorage, hotData: import.meta.hot?.data ?? null });
const startupHasDocuments = startup.previous !== null && startup.previous.documents.length > 0;

function serializableTiles(tiles: OrganizerTile[]): OrganizerTile[] {
  return tiles.map((tile) => (tile.kind === "image" ? { ...tile, previewUrl: "" } : tile));
}

function buildSnapshot(route: string): SessionSnapshot | null {
  const documents = useDocumentStore.getState();
  const organizer = useOrganizerStore.getState();
  const paths = inTabOrder(Object.values(documents.documents), documents.order).map((doc) => sessionPathOf(doc.path));
  if (paths.length === 0) return null;
  const activeDocument = documents.activeId ? documents.documents[documents.activeId] : undefined;
  const activePath = activeDocument ? sessionPathOf(activeDocument.path) : null;
  const main = organizer.sources.main;
  return {
    savedAt: Date.now(),
    route,
    documents: paths,
    activePath,
    tabGroups: savedGroups(documents.order, (id) => {
      const path = documents.documents[id]?.path;
      return path ? sessionPathOf(path) : undefined;
    }),
    organizer:
      main && organizer.tiles.length > 0
        ? {
            mainPath: main.path,
            tiles: serializableTiles(organizer.tiles),
            sources: Object.values(organizer.sources).map(({ id, path, fileName, pageCount }) => ({ id, path, fileName, pageCount })),
            selected: [...organizer.selected],
            cuts: [...organizer.cuts],
            labels: organizer.labels,
          }
        : null,
  };
}

export function SessionManager() {
  const { t } = useTranslation();
  const location = useLocation();
  const restore = useRestoreSession();
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const timerRef = useRef<number | null>(null);
  const everOpenedRef = useRef(false);
  const translateRef = useRef(t);
  translateRef.current = t;
  const routeRef = useRef(location.pathname + location.search);
  routeRef.current = location.pathname + location.search;

  useEffect(() => {
    markSessionRunning();
    if (startup.handled) return;
    markStartupHandled(startup, offerStorage);
    const previous = startup.previous;
    if (previous && startupHasDocuments && startup.reloaded) {
      void restoreRef.current(previous);
      return;
    }
    if (previous && startupHasDocuments && usePreferencesStore.getState().restoreSession) {
      void launchRequest().then((request) => {
        if (request.paths.length === 0) void restoreRef.current(previous);
      });
      return;
    }
    if (!startup.clean) {
      useToastStore.getState().push("info", translateRef.current("crash.detectedToast"), {
        label: translateRef.current("crash.reportAction"),
        onClick: () => useReportStore.getState().openDialog({ category: "crash" }),
      });
    }
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const snapshot = buildSnapshot(routeRef.current);
      if (snapshot || everOpenedRef.current) writeSession(snapshot);
      markPageReload();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (hidesOnClose() || shouldConfirmClose()) {
        event.preventDefault();
        return;
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const snapshot = buildSnapshot(routeRef.current);
      if (snapshot || everOpenedRef.current) writeSession(snapshot);
      markCleanExit();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const snapshot = buildSnapshot(routeRef.current);
      if (!snapshot) {
        if (everOpenedRef.current) writeSession(null);
        return;
      }
      everOpenedRef.current = true;
      timerRef.current = window.setTimeout(() => {
        writeSession(buildSnapshot(routeRef.current));
      }, SAVE_DELAY_MS);
    };
    const unsubscribeDocuments = useDocumentStore.subscribe(schedule);
    const unsubscribeGroups = useTabGroupStore.subscribe(schedule);
    const unsubscribeOrganizer = useOrganizerStore.subscribe(schedule);
    schedule();
    return () => {
      unsubscribeDocuments();
      unsubscribeGroups();
      unsubscribeOrganizer();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [location.pathname, location.search]);

  return null;
}
