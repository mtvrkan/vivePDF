import { useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePresentationLeftoverStore, type LeftoverDrawings } from "@/shared/store/presentationLeftoverStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentSave } from "../useDocumentSave";

export function PresentationDrawingsPrompt({ documentId }: { documentId: string }) {
  const leftover = usePresentationLeftoverStore((state) => state.leftover);
  if (!leftover || leftover.documentId !== documentId) return null;
  return <LeftoverStep documentId={documentId} leftover={leftover} />;
}

function LeftoverStep({ documentId, leftover }: { documentId: string; leftover: LeftoverDrawings }) {
  const { t } = useTranslation();
  const { save } = useDocumentSave(documentId);
  const toast = useToastStore((state) => state.push);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);

  const keep = () => {
    usePendingChangesStore.getState().queue(documentId, { kind: "presentationDrawings", pages: leftover.pages, boards: leftover.boards, label: t("presentation.keep.change") });
    usePresentationLeftoverStore.getState().clear();
  };

  const saveNow = async () => {
    if (started.current) return;
    started.current = true;
    setSaving(true);
    keep();
    await save();
  };

  const keepUnsaved = () => {
    if (saving) return;
    keep();
    toast("info", t("presentation.keep.kept"));
  };

  const discard = () => {
    if (saving) return;
    usePresentationLeftoverStore.getState().clear();
  };

  useEffect(() => {
    if (leftover.finish === "save") void saveNow();
  });

  if (leftover.finish === "save") return null;

  return (
    <Dialog
      open
      title={t("presentation.keep.title")}
      onClose={keepUnsaved}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={discard} className="me-auto text-destructive hover:bg-destructive/10">
            {t("presentation.keep.discard")}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={keepUnsaved}>
            {t("presentation.keep.later")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void saveNow()}>
            {t("presentation.keep.save")}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PenLine className="size-5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed text-muted-foreground">{t(leftover.boards.length > 0 ? "presentation.keep.bodyWithBoards" : "presentation.keep.body")}</p>
      </div>
    </Dialog>
  );
}
