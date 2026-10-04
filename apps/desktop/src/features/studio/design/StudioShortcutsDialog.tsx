import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/shared/Dialog";
import { STUDIO_SHORTCUT_GROUPS } from "./shortcutList";

function splitKeys(keys: string): string[] {
  return keys.split(/\s*(?:\/|·)\s*/).filter(Boolean);
}

export function StudioShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t("studio.shortcuts.title")} onClose={onClose} size="lg">
      <div className="grid gap-3 sm:grid-cols-2" data-testid="studio-shortcuts">
        {STUDIO_SHORTCUT_GROUPS.map((group) => (
          <section key={group.id} className="rounded-xl border p-3" aria-labelledby={`studio-shortcuts-${group.id}`}>
            <h3 id={`studio-shortcuts-${group.id}`} className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Keyboard className="size-3.5" aria-hidden />
              {t(`studio.shortcuts.groups.${group.id}`)}
            </h3>
            <dl>
              {group.items.map((entry) => (
                <div key={entry.keys} className="flex min-h-8 items-center justify-between gap-3 border-b py-1 text-sm last:border-b-0">
                  <dt className="min-w-0 text-start">{t(entry.labelKey)}</dt>
                  <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                    {splitKeys(entry.keys).map((combo) => (
                      <kbd key={combo} className="rounded-sm border bg-background px-1.5 font-mono text-xs text-muted-foreground">
                        {combo}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
