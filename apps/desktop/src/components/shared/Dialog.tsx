import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import { cn } from "@/shared/lib/cn";

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
};

export function Dialog({ open, title, onClose, children, footer, size = "md" }: DialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(panelRef, open, { onEscape: onClose });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) backdrop-blur-sm" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn("flex max-h-[calc(100vh-4rem)] outline-none max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-(--shadow-float)", size === "xl" ? "w-[56rem]" : size === "lg" ? "w-[36rem]" : "w-[26rem]")}
      >
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          <h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            data-dialog-close
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            className="-me-1.5 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 overflow-auto px-5 pb-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/40 px-5 py-3 [&>button]:whitespace-nowrap">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
