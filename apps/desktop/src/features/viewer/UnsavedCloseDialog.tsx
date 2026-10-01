import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useCloseRequestStore } from "@/shared/store/closeRequestStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useDocumentSave } from "./useDocumentSave";
import { useOpenPdf } from "./useOpenPdf";

export function UnsavedCloseDialog() {
  const documentId = useCloseRequestStore((state) => state.queue[0] ?? null);
  const remaining = useCloseRequestStore((state) => state.queue.length);
  const exists = useDocumentStore((state) => (documentId ? Boolean(state.documents[documentId]) : false));

  useEffect(() => {
    if (documentId && !exists) useCloseRequestStore.getState().advance();
  }, [documentId, exists]);

  if (!documentId || !exists) return null;
  return <UnsavedCloseStep key={documentId} documentId={documentId} remaining={remaining} />;
}

function UnsavedCloseStep({ documentId, remaining }: { documentId: string; remaining: number }) {
  const { t } = useTranslation();
  const { save } = useDocumentSave(documentId);
  const { closeDocument } = useOpenPdf();
  const fileName = useDocumentStore((state) => state.documents[documentId]?.fileName ?? "");
  const [saving, setSaving] = useState(false);
  const { advance, cancel } = useCloseRequestStore.getState();

  const saveAndClose = async () => {
    const path = useDocumentStore.getState().documents[documentId]?.path;
    setSaving(true);
    const saved = await save();
    setSaving(false);
    if (!saved) return;
    Object.values(useDocumentStore.getState().documents)
      .filter((document) => document.id === documentId || document.path === path)
      .forEach((document) => closeDocument(document.id));
    advance();
  };

  const discardAndClose = () => {
    usePendingChangesStore.getState().clear(documentId);
    closeDocument(documentId);
    advance();
  };

  return (
    <Dialog
      open
      title={t("viewer.unsavedClose.title")}
      onClose={() => {
        if (!saving) cancel();
      }}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={saving} onClick={discardAndClose}>
            {t("viewer.unsavedClose.discard")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void saveAndClose()}>
            {t("viewer.unsavedClose.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("viewer.unsavedClose.description", { name: fileName })}</p>
      {remaining > 1 ? <p className="mt-2 text-xs text-muted-foreground">{t("viewer.unsavedClose.more", { count: remaining - 1 })}</p> : null}
    </Dialog>
  );
}
