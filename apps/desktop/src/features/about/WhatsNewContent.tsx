import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/shared/Button";
import { cn } from "@/shared/lib/cn";
import { checkUpdatesNow } from "@/shared/lib/helpActions";
import { compareVersions } from "@/shared/lib/lastSeenVersion";
import { notesUpTo, releaseKey } from "./releaseNotes";

export function WhatsNewContent({ version, onNavigate }: { version: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = notesUpTo(version);

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Sparkles className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">{t("whatsNew.emptyTitle")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("whatsNew.emptyDescription", { version })}</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => {
            onNavigate?.();
            checkUpdatesNow(navigate);
          }}
        >
          {t("about.actions.checkUpdates")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("whatsNew.intro")}</p>
      {notes.map((note) => {
        const current = compareVersions(note.version, version) === 0;
        return (
          <section key={note.version} className={cn("rounded-xl border p-4", current && "border-ring")} aria-label={t("whatsNew.version", { version: note.version })}>
            <p className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden />
              {t("whatsNew.version", { version: note.version })}
              {current ? <span className="rounded-full bg-secondary px-2 py-0.5 normal-case tracking-normal text-foreground">{t("whatsNew.current")}</span> : null}
            </p>
            <ul className="list-disc space-y-1.5 ps-5 text-sm leading-5">
              {note.items.map((item) => (
                <li key={item}>{t(`whatsNew.releases.${releaseKey(note.version)}.${item}`)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
