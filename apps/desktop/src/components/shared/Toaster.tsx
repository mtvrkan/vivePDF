import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { useToastStore } from "@/shared/store/toastStore";
import type { ToastKind } from "@/types";

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const ACCENT: Record<ToastKind, string> = {
  info: "text-primary",
  success: "text-success",
  error: "text-destructive",
};

export function Toaster() {
  const { t } = useTranslation();
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const setHeld = useToastStore((state) => state.setHeld);

  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className="glass pointer-events-auto flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm shadow-(--shadow-float)"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", ACCENT[toast.kind])} aria-hidden />
            <span className="min-w-0 flex-1 break-words">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className="flex min-h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium text-primary hover:underline"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t("common.close")}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
