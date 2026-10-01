import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useMakeSearchable } from "./useMakeSearchable";

export function MakeSearchableDialog({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const { pending, running, progress, cancel, confirm } = useMakeSearchable(documentId);
  const percent = Math.round((progress?.progress ?? 0) * 100);

  return (
    <Dialog
      open={pending !== null}
      title={t("viewer.searchable.title")}
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={running}>
            {t("viewer.searchable.run")}
          </Button>
        </>
      }
    >
      {running ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {progress?.message ? t(progress.message, { defaultValue: t("tools.working"), ...progress.detail }) : t("tools.working")}
          </p>
          <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={t("tools.working")} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
      <div className="flex flex-col gap-2 text-sm">
        <p>
          {pending === "document"
            ? t("viewer.searchable.bodyDocument", { name: document?.fileName ?? "" })
            : t("viewer.searchable.bodyPage", { page: (pending?.pageIndex ?? 0) + 1, name: document?.fileName ?? "" })}
        </p>
        <p className="text-muted-foreground">{t("viewer.searchable.hint")}</p>
      </div>
      )}
    </Dialog>
  );
}
