import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { isSourceLibraryPath } from "@/shared/store/studioLaunchStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentStore } from "../document/documentStore";
import { isDocumentPath, loadStudioDocument, openSourceLibraryFile } from "../document/documentFile";
import { reportParseNotices } from "../document/sourceNotices";
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
          const opened = await openSourceLibraryFile(path);
          if (!opened) {
            useToastStore.getState().push("error", t("studio.doc.cite.noEntries"));
            return false;
          }
          useStudioStore.getState().close();
          useDocumentStore.getState().open(opened.document, null, opened.origin);
          useDocumentStore.getState().requestSources(true);
          useToastStore.getState().push("success", t("studio.doc.cite.opened", { total: opened.document.sources.length }));
          reportParseNotices(t, opened.parsed);
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
