import { useMemo } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PAGE_LIST_LIMIT } from "@/components/tool/CheckPages";
import { Section } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { useOpenAtPage } from "@/shared/hooks/useOpenAtPage";
import type { PreflightCheck } from "@/types";
import { findingsByPage } from "./findingsByPage";

export function PageFindings({ path, checks }: { path: string; checks: PreflightCheck[] }) {
  const { t } = useTranslation();
  const openPage = useOpenAtPage(path);
  const rows = useMemo(() => findingsByPage(checks), [checks]);
  if (rows.length === 0) return null;

  return (
    <Section title={t("tools.preflight.byPage")}>
      <ul className="max-h-72 overflow-auto rounded-lg border text-xs">
        {rows.slice(0, PAGE_LIST_LIMIT).map((row) => {
          const Icon = row.status === "fail" ? XCircle : AlertTriangle;
          return (
            <li key={row.page} className="flex items-start gap-3 border-b px-3 py-1.5 last:border-b-0">
              <button
                type="button"
                onClick={() => openPage(row.page)}
                aria-label={t("tools.checkReport.pageList.openPage", { n: row.page })}
                className="glass-chip flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-mono text-foreground outline-none transition-colors hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className={cn("size-3.5", row.status === "fail" ? "text-destructive" : "text-warning")} aria-label={t(`tools.access.status.${row.status}`)} />
                {row.page}
              </button>
              <span className="min-w-0 flex-1 pt-0.5 text-muted-foreground">{row.checks.map((id) => t(`tools.preflight.checks.${id}.title`)).join(" · ")}</span>
            </li>
          );
        })}
      </ul>
      {rows.length > PAGE_LIST_LIMIT ? <p className="text-xs text-muted-foreground">{t("tools.checkReport.pageList.truncated", { limit: PAGE_LIST_LIMIT })}</p> : null}
    </Section>
  );
}
