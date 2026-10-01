import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { ocrSearchable } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentSave } from "./useDocumentSave";
import { useOpenPdf } from "./useOpenPdf";
import type { RpcProgress } from "@/types";
import { useSearchableStore } from "./searchableStore";
import { preferredOcrLanguages } from "./ocrLanguages";

const OCR_DPI = 300;

export function useMakeSearchable(documentId: string) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const { openPath, closeDocument } = useOpenPdf();
  const { unsavedCount } = useDocumentSave(documentId);
  const pending = useSearchableStore((state) => state.pending);
  const cancel = useSearchableStore((state) => state.cancel);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const runningRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const guard = useRef({ document, unsavedCount, toast, t, cancel });
  guard.current = { document, unsavedCount, toast, t, cancel };

  useEffect(() => {
    if (!pending) return;
    const { document: open, unsavedCount: count, toast: push, t: translate, cancel: dismiss } = guard.current;
    if (open && count() === 0) return;
    dismiss();
    if (open) push("error", translate("viewer.searchable.saveFirst"));
  }, [pending]);

  const confirm = async () => {
    const target = pending;
    if (!document || !target) {
      cancel();
      return;
    }
    const selected = preferredOcrLanguages();
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setProgress(null);
    setRunning(true);
    const path = document.path;
    try {
      const result = await ocrSearchable(
        {
          path,
          password: document.password ?? undefined,
          languages: selected,
          dpi: OCR_DPI,
          pages: target === "document" ? undefined : String(target.pageIndex + 1),
        },
        { onProgress: setProgress, signal: controller.signal },
      );
      cancel();
      closeDocument(documentId);
      await openPath(path);
      if (result.pages === 0) toast("info", t("viewer.searchable.nothingToDo"));
      else toast("success", t("viewer.searchable.done", { count: result.pages }));
    } catch (error) {
      cancel();
      const rpcError = toRpcError(error);
      if (rpcError.code === "CANCELLED") toast("info", t("viewer.searchable.cancelled"));
      else toast("error", describeError(t, rpcError));
    } finally {
      controllerRef.current = null;
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
    }
  };

  const dismiss = () => {
    if (runningRef.current) controllerRef.current?.abort();
    else cancel();
  };

  return { pending, running, progress, cancel: dismiss, confirm };
}
