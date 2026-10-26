import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CheckPages } from "@/components/tool/CheckPages";
import { cn } from "@/shared/lib/cn";
import type { ThesisCheckItem, ThesisCheckStatus } from "@/types";
import { checksByGroup } from "./thesisCheckRules";
import { useThesisDetail } from "./useThesisDetail";

const STATUS_ICON: Record<ThesisCheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle, skip: MinusCircle };
const STATUS_CLASS: Record<ThesisCheckStatus, string> = { pass: "text-success", warn: "text-warning", fail: "text-destructive", skip: "text-muted-foreground" };

export function ThesisReport({ path, checks }: { path: string; checks: ThesisCheckItem[] }) {
  const { t } = useTranslation();
  const detailOf = useThesisDetail();

  return (
    <div className="flex flex-col gap-4" data-thesis-report>
      {checksByGroup(checks).map(({ group, items }) => (
        <section key={group} aria-labelledby={`thesis-group-${group}`}>
          <h3 id={`thesis-group-${group}`} className="mb-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t(`tools.thesisCheck.groups.${group}`)}
          </h3>
          <ul className="rounded-lg border text-sm">
            {items.map((item) => {
              const Icon = STATUS_ICON[item.status];
              return (
                <li key={item.id} data-thesis-check={item.id} data-status={item.status} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", STATUS_CLASS[item.status])} aria-label={t(`tools.thesisCheck.status.${item.status}`)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{t(`tools.thesisCheck.checks.${item.id}.title`)}</span>
                    <span className="text-xs text-muted-foreground">{detailOf(item)}</span>
                    {item.status === "warn" || item.status === "fail" ? <CheckPages path={path} pages={item.pages} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
