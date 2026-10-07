import { ArchiveRestore, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { isPageDeleted, NO_PAGE_EDITS, pageRotation, pendingPageEdits, storePageEdits, toggleDeleted } from "./pageEdits";

export function PageEditLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { t } = useTranslation();
  const deleted = usePendingChangesStore((state) => isPageDeleted(pendingPageEdits(pendingChangesFor(state.changes, documentId)) ?? NO_PAGE_EDITS, pageIndex));
  const turn = usePendingChangesStore((state) => pageRotation(pendingPageEdits(pendingChangesFor(state.changes, documentId)) ?? NO_PAGE_EDITS, pageIndex));

  if (!deleted && turn === 0) return null;

  const restore = () => {
    const current = pendingPageEdits(pendingChangesFor(usePendingChangesStore.getState().changes, documentId)) ?? NO_PAGE_EDITS;
    const next = toggleDeleted(current, pageIndex, Number.POSITIVE_INFINITY);
    if (next) storePageEdits(documentId, next, t("viewer.pageEdits.label"));
  };

  if (deleted) {
    return (
      <div data-page-edit-layer="deleted" className="absolute inset-0 z-10 flex items-center justify-center bg-background/75 backdrop-grayscale">
        <div role="status" className="pointer-events-auto flex max-w-xs flex-col items-center gap-3 rounded-xl border bg-card p-4 text-center shadow-(--shadow-card)" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <Trash2 className="size-5 text-destructive" aria-hidden />
          <p className="text-sm text-foreground">{t("viewer.pageEdits.willDelete")}</p>
          <Button size="sm" icon={<ArchiveRestore className="size-4" aria-hidden />} onClick={restore}>
            {t("viewer.pageEdits.restore")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-page-edit-layer="rotated" className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <span role="status" className="glass-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground">
        <RotateCw className="size-3.5 text-primary" aria-hidden />
        {t("viewer.pageEdits.willRotate", { degrees: turn })}
      </span>
    </div>
  );
}
