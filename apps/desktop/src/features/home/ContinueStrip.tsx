import { useState } from "react";
import { History, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { basenameOf } from "@/shared/lib/paths";
import { readSession, readStartupSession, writeSession } from "@/shared/session/sessionStore";
import { useRestoreSession } from "@/shared/session/useRestoreSession";
import { useOpenStore } from "@/shared/store/openStore";

export function ContinueStrip() {
  const { t } = useTranslation();
  const [session] = useState(() => (readSession() ? readStartupSession() : null));
  const [restored, setRestored] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const restoreSession = useRestoreSession();
  const busy = useOpenStore((state) => state.busy);

  if (restored || discarded || !session || session.documents.length === 0) return null;

  const discard = () => {
    writeSession(null);
    setDiscarded(true);
  };

  const shown = session.documents.slice(0, 3);

  return (
    <section className="glass glass-tinted rounded-2xl p-5" data-tone="improve">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.lastSession")}</p>
      <p className="mt-1 text-sm">{t("recovery.lastSessionDescription", { count: session.documents.length })}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {shown.map((path) => (
          <li key={path} title={path} className="glass-chip max-w-full truncate rounded-full px-3 py-1 text-xs">
            {basenameOf(path)}
          </li>
        ))}
        {session.documents.length > shown.length ? (
          <li className="rounded-full px-2 py-1 text-xs text-muted-foreground">{t("common.andMore", { count: session.documents.length - shown.length })}</li>
        ) : null}
      </ul>
      <div className="mt-4 flex flex-col gap-1.5">
        <Button icon={<History className="size-4" aria-hidden />} onClick={() => void restoreSession(session).then((ok) => setRestored(ok))} disabled={busy} className="w-full rounded-full">
          {t("recovery.restoreLast")}
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" aria-hidden />} onClick={discard} disabled={busy} className="w-full rounded-full text-muted-foreground">
          {t("recovery.discard")}
        </Button>
      </div>
    </section>
  );
}
