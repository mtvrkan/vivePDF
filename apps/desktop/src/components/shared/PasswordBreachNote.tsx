import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePasswordBreach, type PasswordBreachState } from "@/shared/hooks/usePasswordBreach";
import { formatNumber } from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";

export function PasswordBreachAlert({ state }: { state: PasswordBreachState }) {
  const { t } = useTranslation();
  const locale = useUiStore((ui) => ui.locale);
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {state.breached ? (
        <p className="mt-1.5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {state.variant
            ? t("password.breach.foundVariant")
            : state.count
              ? t("password.breach.foundCount", { count: state.count, formatted: formatNumber(state.count, locale) })
              : t("password.breach.foundList")}
        </p>
      ) : null}
      {state.onlineUnavailable ? <span className="mt-1 block text-xs text-muted-foreground">{t("password.breach.onlineUnavailable")}</span> : null}
    </div>
  );
}

export function PasswordBreachWarning({ password }: { password: string }) {
  const state = usePasswordBreach(password);
  return <PasswordBreachAlert state={state} />;
}
