import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInRouterContext, useNavigate } from "react-router";
import { useOffline } from "@/shared/lib/offline";
import { cn } from "@/shared/lib/cn";

function SettingsLink() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button type="button" className="shrink-0 font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void navigate("/settings?section=web")}>
      {t("offline.openSettings")}
    </button>
  );
}

export function OfflineNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  const inRouter = useInRouterContext();
  const offline = useOffline();
  if (!offline) return null;
  return (
    <p role="status" data-testid="offline-notice" className={cn("flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-foreground/80", className)}>
      <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{t("offline.notice")}</span>
      {inRouter ? <SettingsLink /> : null}
    </p>
  );
}
