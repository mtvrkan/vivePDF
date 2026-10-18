import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { useModalFocus } from "@/shared/hooks/useModalFocus";

export function BoardClearConfirm({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useModalFocus(panelRef, true, { onEscape: onCancel });

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-(--overlay)" onPointerDown={(event) => event.stopPropagation()} onMouseDown={onCancel}>
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-96 max-w-[calc(100vw-2rem)] rounded-2xl border bg-card p-5 text-foreground shadow-(--shadow-float) outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {t("presentation.board.clearTitle")}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-muted-foreground">
          {t("presentation.board.clearBody", { count })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm}>
            {t("presentation.board.clear")}
          </Button>
        </div>
      </div>
    </div>
  );
}
