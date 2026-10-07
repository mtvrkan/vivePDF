import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { useScrollCapability } from "@embedpdf/plugin-scroll/react";
import * as logger from "@/shared/lib/logger";
import { pathKey } from "@/shared/lib/paths";
import { useDocumentStore } from "@/shared/store/documentStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useSplitViewStore } from "@/shared/store/splitViewStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { originalOf, useConvertedStore } from "./convertedDocuments";
import { fileChangeStatusOf, useFileChangeStore } from "./fileChangeStore";
import { fileChangeAction, watchablePaths, type DocumentFileChanged } from "./fileChangeDecision";
import { isPendingChange } from "./overlay/pending";
import { reloadDocument } from "./useReloadDocument";
import { useOpenPdf } from "./useOpenPdf";

export const DOCUMENT_FILE_CHANGED_EVENT = "document-file-changed";

function failed(action: string, path: string) {
  return (caught: unknown) => logger.warn("viewer.fileWatch", `${action} failed for ${path}: ${String(caught)}`);
}

export function useDocumentFileWatch() {
  const { t } = useTranslation();
  const { openPath, closeDocument } = useOpenPdf();
  const { provides: historyCapability } = useHistoryCapability();
  const { provides: scrollCapability } = useScrollCapability();
  const deps = useRef({ t, openPath, closeDocument, historyCapability, scrollCapability });
  deps.current = { t, openPath, closeDocument, historyCapability, scrollCapability };

  useEffect(() => {
    const watched = new Map<string, string>();
    let reloading = false;

    const sync = () => {
      const documents = Object.values(useDocumentStore.getState().documents);
      const wanted = watchablePaths(
        documents.map((document) => document.path),
        (path) => originalOf(path) !== null,
      );
      for (const [key, path] of watched) {
        if (wanted.has(key)) continue;
        watched.delete(key);
        void invoke("unwatch_document", { path }).catch(failed("unwatch", path));
      }
      for (const [key, path] of wanted) {
        if (watched.has(key)) continue;
        watched.set(key, path);
        void invoke("watch_document", { path }).catch(failed("watch", path));
      }
      useFileChangeStore.getState().keepOnly(documents.map((document) => document.path));
    };

    const hasUnsavedWork = (documentId: string) => {
      if (pendingChangesFor(usePendingChangesStore.getState().changes, documentId).length > 0) return true;
      const overlay = useViewerOverlayStore.getState();
      if (overlay.editingDocumentId === documentId && overlay.objects.some(isPendingChange)) return true;
      try {
        return deps.current.historyCapability?.forDocument(documentId).canUndo() ?? false;
      } catch {
        return false;
      }
    };

    const currentPage = (documentId: string) => {
      try {
        return deps.current.scrollCapability?.forDocument(documentId).getCurrentPage() ?? 1;
      } catch {
        return 1;
      }
    };

    const reloadNow = async (documentId: string, path: string) => {
      reloading = true;
      useFileChangeStore.getState().clear(path);
      const { t: translate, openPath: open, closeDocument: close } = deps.current;
      try {
        const reloaded = await reloadDocument(documentId, { openPath: open, closeDocument: close, page: currentPage(documentId) });
        if (reloaded) useToastStore.getState().push("info", translate("viewer.fileChanged.updated"));
      } finally {
        reloading = false;
      }
      reloadActiveIfStale();
    };

    const reloadActiveIfStale = () => {
      if (reloading) return;
      const { activeId, documents } = useDocumentStore.getState();
      const active = activeId ? documents[activeId] : undefined;
      if (!active || fileChangeStatusOf(active.path) !== "stale") return;
      if (hasUnsavedWork(active.id)) {
        useFileChangeStore.getState().mark(active.path, "conflict");
        return;
      }
      void reloadNow(active.id, active.path);
    };

    const handle = (change: DocumentFileChanged) => {
      const wanted = pathKey(change.path);
      const { documents, activeId } = useDocumentStore.getState();
      const matching = Object.values(documents).filter((document) => pathKey(document.path) === wanted);
      if (matching.length === 0) return;
      const reloadOnChange = usePreferencesStore.getState().reloadOnFileChange;
      for (const document of matching) {
        if (change.exists) useSplitViewStore.getState().refresh(document.path);
        const action = fileChangeAction({ exists: change.exists, unsaved: hasUnsavedWork(document.id), reloadOnChange, active: document.id === activeId });
        if (action === "reload") {
          if (!reloading) void reloadNow(document.id, document.path);
          else useFileChangeStore.getState().mark(document.path, "stale");
        } else useFileChangeStore.getState().mark(document.path, action);
      }
    };

    sync();
    const stopDocuments = useDocumentStore.subscribe((state, previous) => {
      if (state.documents !== previous.documents) sync();
      if (state.activeId !== previous.activeId) reloadActiveIfStale();
    });
    const stopConverted = useConvertedStore.subscribe((state, previous) => {
      if (state.originals !== previous.originals) sync();
    });
    const unlisten = listen<DocumentFileChanged>(DOCUMENT_FILE_CHANGED_EVENT, (event) => handle(event.payload));

    return () => {
      stopDocuments();
      stopConverted();
      void unlisten.then((stop) => stop());
      for (const path of watched.values()) void invoke("unwatch_document", { path }).catch(failed("unwatch", path));
      watched.clear();
    };
  }, []);
}
