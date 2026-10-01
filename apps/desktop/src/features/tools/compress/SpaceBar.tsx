import { useTranslation } from "react-i18next";
import { formatBytes } from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";
import type { SpaceKind, SpaceReport } from "@/types";

const TINT: Record<SpaceKind, string> = {
  image: "bg-[color-mix(in_oklab,var(--tone)_88%,transparent)]",
  font: "bg-[color-mix(in_oklab,var(--tone)_52%,transparent)]",
  content: "bg-[color-mix(in_oklab,var(--tone)_26%,transparent)]",
  metadata: "bg-muted-foreground/35",
  attachment: "bg-muted-foreground/50",
  other: "bg-muted-foreground/20",
};

export function SpaceBar({ report }: { report: SpaceReport }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const measured = report.groups.reduce((sum, group) => sum + group.bytes, 0);
  if (measured <= 0) return null;

  return (
    <div className="space-y-2">
      <div role="img" aria-label={report.groups.map((group) => `${t(`tools.compress.space.${group.kind}`)} ${formatBytes(group.bytes, locale)}`).join(", ")} className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-secondary">
        {report.groups.map((group) => (
          <span key={group.kind} className={TINT[group.kind]} style={{ width: `${(group.bytes / measured) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {report.groups.map((group) => (
          <li key={group.kind} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${TINT[group.kind]}`} />
            <span className="text-foreground/80">{t(`tools.compress.space.${group.kind}`)}</span>
            <span className="font-mono text-muted-foreground">{formatBytes(group.bytes, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
