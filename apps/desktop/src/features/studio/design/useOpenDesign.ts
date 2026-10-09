import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { isSourceLibraryPath } from "@/shared/store/studioLaunchStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentStore } from "../document/documentStore";
import { isDocumentPath, loadStudioDocument, openSourceLibrary } from "../document/documentFile";
import { loadDesign } from "./projectFile";
import { useRecentDesignsStore } from "./recentDesigns";
import { useStudioStore } from "./studioStore";

export function useOpenDesign() {
  const { t } = useTranslation();
  const [opening, setOpening] = useState<string | null>(null);
  const openDesign = useCallback(
    async (path: string, password: string | null = null): Promise<boolean> => {
      setOpening(path);
      try {
        if (isSourceLibraryPath(path)) {
          const document = await openSourceLibrary(path);
          if (!document) {
            useToastStore.getState().push("error", t("studio.doc.cite.noEntries"));
            return false;
          }
          useStudioStore.getState().close();
          useDocumentStore.getState().open(document);
          useDocumentStore.getState().requestSources(true);
          useToastStore.getState().push("success", t("studio.doc.cite.opened", { count: document.sources.length }));
          return true;
        }
        if (isDocumentPath(path)) {
          const document = await loadStudioDocument(path);
          useStudioStore.getState().close();
          useDocumentStore.getState().open(document, path);
          return true;
        }
        const loaded = await loadDesign(path, password);
        useDocumentStore.getState().close();
        useStudioStore.getState().open(loaded.design, loaded.filePath);
        return true;
      } catch (error) {
        const rpcError = toRpcError(error);
        if (rpcError.code === "FILE_NOT_FOUND") {
          useRecentDesignsStore.getState().remove(path);
          useToastStore.getState().push("error", t("studio.project.missing"));
        } else {
          useToastStore.getState().push("error", describeError(t, rpcError));
        }
        return false;
      } finally {
        setOpening(null);
      }
    },
    [t],
  );
  return { opening, openDesign };
}
