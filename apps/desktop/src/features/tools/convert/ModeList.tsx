import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { ConversionEntry, ConvertMode } from "./conversions";

export function ModeList({ title, entries, mode, onSelect, tools }: {
  title: string;
  entries: ConversionEntry[];
  mode: ConvertMode;
  onSelect: (mode: ConvertMode) => void;
  tools: { libreoffice: string | null } | null;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      {entries.map((entry) => {
        const Icon = entry.icon;
        const missing = entry.requires && tools && !tools[entry.requires];
        return (
          <button
            key={entry.mode}
            type="button"
            onClick={() => onSelect(entry.mode)}
            aria-current={mode === entry.mode ? "true" : undefined}
            className={cn(
              "flex h-row w-full items-center gap-2.5 border-s-2 px-3 text-start text-sm",
              mode === entry.mode ? "border-primary bg-accent font-medium text-accent-foreground" : "border-transparent hover:bg-secondary",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span title={t(`tools.convert.modes.${entry.mode}`)} className="min-w-0 flex-1 truncate">{t(`tools.convert.modes.${entry.mode}`)}</span>
            {missing ? (
              <span className="font-mono text-xs text-warning" title={t("tools.convert.needsLibreOffice")}>
                <span aria-hidden>!</span>
                <span className="sr-only">{t("tools.convert.needsLibreOffice")}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
