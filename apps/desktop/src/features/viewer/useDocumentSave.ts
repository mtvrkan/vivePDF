import { useRef } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useRedaction } from "@embedpdf/plugin-redaction/react";
import { useExport } from "@embedpdf/plugin-export/react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { basenameOf, siblingPath } from "@/shared/lib/paths";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { writeDocumentBytes } from "@/shared/rpc/files";
import { addAttachments, addBookmark, deleteComments, removeAttachments, replyToComment, setCommentsResolved, setCommentsState, setMetadata } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { pendingChangesFor, usePendingChangesStore, type PendingChange } from "@/shared/store/pendingChangesStore";
import { useSplitViewStore } from "@/shared/store/splitViewStore";
import { useToastStore } from "@/shared/store/toastStore";
import { planRedactionScrub, scrubRedactedFile } from "./redactionScrub";
import { annotationAuthorName } from "./annotationAuthor";
import { invalidatePageText } from "./pageTextCache";
import { useReloadDocument } from "./useReloadDocument";
import { restoreSavedView } from "./viewableBytes";
import { originalOf, useConvertedStore } from "./convertedDocuments";

const UNDO_LIMIT = 500;

async function applyChange(change: PendingChange, path: string, password: string | undefined) {
  const author = annotationAuthorName(usePreferencesStore.getState().annotationAuthor);
  if (change.kind === "commentResolved") await setCommentsResolved({ path, password, xrefs: change.xrefs, resolved: change.resolved, author });
  else if (change.kind === "commentDeleted") await deleteComments({ path, password, xrefs: change.xrefs });
  else if (change.kind === "commentState") await setCommentsState({ path, password, xrefs: change.xrefs, state: change.state ?? "None", author });
  else if (change.kind === "commentReply") await replyToComment({ path, password, xref: change.parent, content: change.content, author });
  else if (change.kind === "attachmentAdded") await addAttachments({ path, password, files: change.files });
  else if (change.kind === "metadataChanged") await setMetadata({ path, password, inPlace: true, ...change.metadata });
  else if (change.kind === "bookmarkAdded") await addBookmark({ path, password, title: change.title, page: change.page, x: change.x, y: change.y });
  else await removeAttachments({ path, password, names: change.names });
}

export function useDocumentSave(documentId: string) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const { provides: annotation } = useAnnotation(documentId);
  const { provides: redaction, state: redactionState } = useRedaction(documentId);
  const { provides: exporter } = useExport(documentId);
  const { provides: historyCapability } = useHistoryCapability();
  const pendingCount = redactionState.pendingCount;
  const pendingRedactions = redactionState.pending;
  const reload = useReloadDocument(documentId);

  const refs = useRef({ annotation, redaction, exporter, historyCapability, pendingCount, pendingRedactions });
  refs.current = { annotation, redaction, exporter, historyCapability, pendingCount, pendingRedactions };

  const markCount = () => {
    const history = refs.current.historyCapability?.forDocument(documentId);
    return history?.canUndo() ? 1 : 0;
  };

  const queuedChanges = () => pendingChangesFor(usePendingChangesStore.getState().changes, documentId);

  const unsavedCount = () => markCount() + queuedChanges().length;

  const save = async (targetPath?: string): Promise<boolean> => {
    const document = useDocumentStore.getState().documents[documentId];
    if (!document) return false;
    const original = targetPath ? null : originalOf(document.path);
    let path = targetPath ?? document.path;
    if (original) {
      const picked = await saveDialog({ defaultPath: siblingPath(original, "pdf"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!picked) return false;
      path = picked.toLowerCase().endsWith(".pdf") ? picked : `${picked}.pdf`;
    }
    const samePath = path === document.path;
    const settles = samePath || original !== null;
    const password = document.password ?? undefined;
    const queued = queuedChanges();
    const hasMarks = markCount() > 0;
    if (samePath && !hasMarks && queued.length === 0) return true;
    try {
      let scrubbed = 0;
      if (hasMarks || !samePath) {
        const current = refs.current;
        if (!current.exporter) return false;
        const scrubPlan = current.pendingCount > 0 ? await planRedactionScrub(document.path, password, current.pendingRedactions) : null;
        if (current.pendingCount > 0) await current.redaction?.commitAllPending().toPromise();
        await current.annotation?.commit().toPromise();
        const bytes = await current.exporter.saveAsCopy().toPromise();
        if (!bytes) return false;
        await writeDocumentBytes(path, bytes);
        await restoreSavedView(document.path, path, password);
        scrubbed = await scrubRedactedFile(path, password, scrubPlan);
      }
      for (const change of queued) {
        await applyChange(change, path, password);
        if (settles) usePendingChangesStore.getState().drop(documentId, change.id);
      }
      if (settles) {
        usePendingChangesStore.getState().clear(documentId);
        refs.current.historyCapability?.forDocument(documentId).purgeByMetadata(() => true);
      }
      if (original) {
        useConvertedStore.getState().forget(document.path);
        useDocumentStore.getState().register(documentId, path, document.password);
        void useDocumentStore.getState().loadInfo(documentId);
      }
      toast("success", t("viewer.save.saved", { name: basenameOf(path) }));
      if (scrubbed > 0) toast("info", t("viewer.save.hiddenScrubbed", { count: scrubbed }));
      if (samePath) {
        useSplitViewStore.getState().refresh(path);
        invalidatePageText(documentId);
      }
      if (samePath && (scrubbed > 0 || queued.length > 0)) await reload();
      else if (samePath) void useDocumentStore.getState().loadInfo(documentId);
      return true;
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
      return false;
    }
  };

  const discard = () => {
    usePendingChangesStore.getState().clear(documentId);
    const history = refs.current.historyCapability?.forDocument(documentId);
    if (!history) return;
    let steps = 0;
    while (history.canUndo() && steps < UNDO_LIMIT) {
      history.undo();
      steps += 1;
    }
  };

  return { save, discard, unsavedCount, queuedChanges };
}
