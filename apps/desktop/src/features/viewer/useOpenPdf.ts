import { useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { join, tempDir } from "@tauri-apps/api/path";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { toRpcError } from "@/shared/rpc/client";
import { claimDocument, fileNameOf, isPdfPath, releaseViewSource, rememberRecentDocument } from "@/shared/rpc/files";
import { preparedViewSource, readViewableSource } from "@/features/viewer/viewableBytes";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useNavHistoryStore } from "@/shared/store/navHistoryStore";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";
import { useLayerViewStore } from "@/shared/store/layerViewStore";
import { usePageDisplayStore } from "@/shared/store/pageDisplayStore";
import { usePageLabelsStore } from "@/shared/store/pageLabelsStore";
import { useOpenStore } from "@/shared/store/openStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { documentRoomError } from "@/shared/lib/documentLimit";
import { describeError } from "@/shared/lib/errorMessage";
import { isPdfPasswordError } from "@/shared/lib/pdfPassword";
import { canOfferRepair, openInRepair } from "@/shared/lib/repairRoute";
import { sealedOpenRoute } from "@/shared/lib/sealedRoute";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { clipboardToPdf, fileToPdf } from "@/shared/rpc/operations";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath, pathKey, stemOf } from "@/shared/lib/paths";
import { useLaunchStore } from "@/shared/store/launchStore";
import { isDesignPath, useStudioLaunchStore } from "@/shared/store/studioLaunchStore";
import { convertedCopyOf, isConvertibleOnOpen, isOpenablePath, isUnsavedCopy, OPEN_CONVERTIBLE_EXTENSIONS, originalOf, useConvertedStore } from "./convertedDocuments";
import { closeViewable, openViewable, type ViewableSource } from "@/shared/session/viewSources";
import { STUDIO_PROJECT_EXTENSION } from "@/types/studio";

function forgetDocumentState(documentId: string) {
  usePendingChangesStore.getState().clear(documentId);
  useNavHistoryStore.getState().clear(documentId);
  usePageLabelsStore.getState().forget(documentId);
  usePageDisplayStore.getState().forget(documentId);
  useDocumentMessagesStore.getState().forget(documentId);
  useFallbackFontsStore.getState().forget(documentId);
  useLayerViewStore.getState().forgetList(documentId);
}

export function clipboardStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

export function useOpenPdf(documentRoute = "/viewer") {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const goToDocument = useCallback(() => {
    if (pathname === "/pages") return;
    void navigate(documentRoute);
  }, [navigate, pathname, documentRoute]);
  const { provides: docManager } = useDocumentManagerCapability();
  const registerDocument = useDocumentStore((state) => state.register);
  const removeDocument = useDocumentStore((state) => state.remove);
  const setActive = useDocumentStore((state) => state.setActive);
  const activateDocument = useDocumentStore((state) => state.activate);
  const loadInfo = useDocumentStore((state) => state.loadInfo);
  const addRecent = useRecentStore((state) => state.add);
  const setBusy = useOpenStore((state) => state.setBusy);
  const requestPassword = useOpenStore((state) => state.requestPassword);
  const toast = useToastStore((state) => state.push);

  const finishOpen = useCallback(
    (documentId: string, path: string) => {
      if (!isUnsavedCopy(path)) {
        const recentPath = originalOf(path) ?? path;
        addRecent(recentPath);
        if (usePreferencesStore.getState().rememberRecent) void rememberRecentDocument(recentPath).catch(() => undefined);
      }
      setActive(documentId);
      requestPassword(null);
      void loadInfo(documentId);
      goToDocument();
    },
    [addRecent, setActive, requestPassword, loadInfo, goToDocument],
  );

  const openPath = useCallback(
    async (path: string): Promise<boolean> => {
      if (isDesignPath(path)) {
        useStudioLaunchStore.getState().request({ path, password: null });
        void navigate("/studio");
        return true;
      }
      if (!docManager) {
        toast("info", t("engine.starting"));
        return false;
      }
      if (!isPdfPath(path)) {
        if (!isConvertibleOnOpen(path)) {
          toast("error", t("errors.INVALID_PDF"));
          return false;
        }
        const copy = convertedCopyOf(path);
        const converted = copy ? Object.values(useDocumentStore.getState().documents).find((doc) => pathKey(doc.path) === copy) : undefined;
        if (converted && activateDocument(converted.id, docManager)) {
          goToDocument();
          return true;
        }
        const noRoomForCopy = documentRoomError(docManager.getDocumentCount());
        if (noRoomForCopy) {
          toast("error", describeError(t, noRoomForCopy));
          return false;
        }
        setBusy(true);
        toast("info", t("viewer.converted.converting", { name: fileNameOf(path) }));
        let output: string;
        try {
          output = await join(await tempDir(), "vivepdf-converted", crypto.randomUUID(), `${stemOf(path)}.pdf`);
          await fileToPdf({ path, output, overwrite: true });
        } catch (error) {
          const rpcError = toRpcError(error);
          const toolRoute = "/tools/convert?mode=file-to-pdf";
          toast("error", describeError(t, rpcError), {
            label: t("viewer.converted.openTool"),
            onClick: () => {
              useLaunchStore.getState().setPending(path, toolRoute);
              void navigate(toolRoute);
            },
          });
          return false;
        } finally {
          setBusy(false);
        }
        useConvertedStore.getState().remember(output, path);
        return openPathRef.current(output);
      }
      const alreadyOpen = Object.values(useDocumentStore.getState().documents).find((doc) => doc.path === path);
      if (alreadyOpen && activateDocument(alreadyOpen.id, docManager)) {
        goToDocument();
        return true;
      }
      const noRoom = documentRoomError(docManager.getDocumentCount());
      if (noRoom) {
        toast("error", describeError(t, noRoom));
        return false;
      }
      if (await claimDocument(path)) return false;
      const documentId = crypto.randomUUID();
      setBusy(true);
      try {
        const source = await readViewableSource(path);
        registerDocument(documentId, path, null);
        await openViewable(docManager, source, { name: fileNameOf(path), documentId });
        finishOpen(documentId, path);
        return true;
      } catch (error) {
        const sealed = await sealedOpenRoute(path, (target) => getDocumentInfo({ path: target }));
        if (sealed) {
          docManager.closeDocument(documentId);
          removeDocument(documentId);
          toast("error", t("errors.CERTIFICATE_SEALED"), { label: t("tools.security.decryptCertificate.openSealed"), onClick: () => void navigate(sealed) });
          return false;
        }
        if (isPdfPasswordError(error)) {
          requestPassword({ documentId, fileName: fileNameOf(path), wrongPassword: false });
          return false;
        }
        docManager.closeDocument(documentId);
        removeDocument(documentId);
        const rpcError = toRpcError(error);
        const repair = canOfferRepair(rpcError, path, false) ? { label: t("tools.edit.repair.repairFile"), onClick: () => openInRepair(path, navigate) } : undefined;
        toast("error", describeError(t, rpcError), repair);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [docManager, t, toast, navigate, activateDocument, goToDocument, setBusy, registerDocument, finishOpen, requestPassword, removeDocument],
  );
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  const submitPassword = useCallback(
    async (documentId: string, password: string) => {
      if (!docManager) return;
      const document = useDocumentStore.getState().documents[documentId];
      if (!document) return;
      setBusy(true);
      try {
        const renamedCopy = await preparedViewSource(document.path, password);
        if (renamedCopy) {
          const copyId = crypto.randomUUID();
          const opened = await openViewable(docManager, renamedCopy, { name: document.fileName, documentId: copyId, password }).then(
            () => true,
            () => {
              closeViewable(docManager, copyId);
              return false;
            },
          );
          if (opened) {
            docManager.closeDocument(documentId);
            removeDocument(documentId);
            registerDocument(copyId, document.path, password);
            finishOpen(copyId, document.path);
            return;
          }
        }
        const response = await docManager.retryDocument(documentId, { password }).toPromise();
        await response.task.toPromise();
        registerDocument(documentId, document.path, password);
        finishOpen(documentId, document.path);
      } catch (error) {
        if (isPdfPasswordError(error)) {
          requestPassword({ documentId, fileName: document.fileName, wrongPassword: true });
          return;
        }
        removeDocument(documentId);
        requestPassword(null);
        const rpcError = toRpcError(error);
        toast("error", describeError(t, rpcError));
      } finally {
        setBusy(false);
      }
    },
    [docManager, setBusy, registerDocument, finishOpen, requestPassword, removeDocument, toast, t],
  );

  const cancelPassword = useCallback(
    (documentId: string) => {
      requestPassword(null);
      removeDocument(documentId);
      docManager?.closeDocument(documentId);
    },
    [docManager, requestPassword, removeDocument],
  );

  const openPaths = useCallback(
    async (paths: string[]) => {
      const store = useOpenStore.getState();
      if (store.passwordRequest) {
        store.queueWaiting(paths);
        return;
      }
      for (let index = 0; index < paths.length; index += 1) {
        const opened = await openPath(paths[index]);
        if (!opened && useOpenStore.getState().passwordRequest) {
          useOpenStore.getState().queueWaiting(paths.slice(index + 1));
          return;
        }
      }
    },
    [openPath],
  );

  const openClipboard = useCallback(async (): Promise<boolean> => {
    if (!docManager) {
      toast("info", t("engine.starting"));
      return false;
    }
    const noRoom = documentRoomError(docManager.getDocumentCount());
    if (noRoom) {
      toast("error", describeError(t, noRoom));
      return false;
    }
    const name = sanitizeFileName(`${t("clipboard.fileName")} ${clipboardStamp(new Date())}`) || "clipboard";
    setBusy(true);
    let result: Awaited<ReturnType<typeof clipboardToPdf>>;
    try {
      const output = await join(await tempDir(), "vivepdf-converted", crypto.randomUUID(), `${name}.pdf`);
      result = await clipboardToPdf({ output, overwrite: true });
    } catch (error) {
      const rpcError = toRpcError(error);
      toast(rpcError.data?.reason === "clipboardEmpty" ? "info" : "error", describeError(t, rpcError));
      return false;
    } finally {
      setBusy(false);
    }
    if (result.kind === "files") {
      const openable = result.files.filter(isOpenablePath);
      if (openable.length === 0) {
        toast("info", t("clipboard.noOpenableFiles"));
        return false;
      }
      await openPaths(openable);
      return true;
    }
    if (!result.output) return false;
    useConvertedStore.getState().rememberUnsaved(result.output, joinPath(await defaultOutputDirectory(), `${name}.pdf`));
    return openPathRef.current(result.output);
  }, [docManager, openPaths, setBusy, t, toast]);

  const pickAndOpen = useCallback(async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [
        { name: t("viewer.converted.allSupported"), extensions: ["pdf", ...OPEN_CONVERTIBLE_EXTENSIONS, STUDIO_PROJECT_EXTENSION] },
        { name: "PDF", extensions: ["pdf"] },
      ],
    });
    if (!selected) return;
    await openPaths(Array.isArray(selected) ? selected : [selected]);
  }, [openPaths, t]);

  const closeDocument = useCallback(
    (documentId: string) => {
      const current = docManager?.getActiveDocumentId() ?? null;
      const path = useDocumentStore.getState().documents[documentId]?.path;
      docManager?.closeDocument(documentId);
      removeDocument(documentId);
      forgetDocumentState(documentId);
      if (path) useLayerViewStore.getState().clearChoices(path);
      const remaining = Object.keys(useDocumentStore.getState().documents);
      const next = current && current !== documentId && remaining.includes(current) ? current : (remaining.at(-1) ?? null);
      if (!next || !activateDocument(next, docManager)) setActive(null);
    },
    [docManager, removeDocument, setActive, activateDocument],
  );

  const replaceDocument = useCallback(
    async (documentId: string, source: ViewableSource): Promise<boolean> => {
      const document = useDocumentStore.getState().documents[documentId];
      if (!docManager || !document) {
        if (source.kind === "range") void releaseViewSource(source.token);
        return false;
      }
      const copyId = crypto.randomUUID();
      const opened = await openViewable(docManager, source, { name: document.fileName, documentId: copyId, ...(document.password ? { password: document.password } : {}) }).then(
        () => true,
        () => {
          closeViewable(docManager, copyId);
          return false;
        },
      );
      if (!opened) return false;
      docManager.closeDocument(documentId);
      removeDocument(documentId);
      forgetDocumentState(documentId);
      registerDocument(copyId, document.path, document.password);
      finishOpen(copyId, document.path);
      return true;
    },
    [docManager, removeDocument, registerDocument, finishOpen],
  );

  const activate = useCallback(
    (documentId: string) => {
      activateDocument(documentId, docManager);
    },
    [docManager, activateDocument],
  );

  const resumeWaiting = useCallback(() => {
    const store = useOpenStore.getState();
    if (store.passwordRequest) return;
    const waiting = store.takeWaiting();
    if (waiting.length > 0) void openPaths(waiting);
  }, [openPaths]);

  return { openPath, openPaths, openClipboard, resumeWaiting, pickAndOpen, submitPassword, cancelPassword, closeDocument, replaceDocument, activate };
}
