import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOpenAtPage } from "@/shared/hooks/useOpenAtPage";
import type { ThesisCheckItem } from "@/types";
import { useThesisPageLine } from "./useThesisDetail";

export function ThesisPageDetails({ path, item }: { path: string; item: ThesisCheckItem }) {
  const { t } = useTranslation();
  const openPage = useOpenAtPage(path);
  const lineOf = useThesisPageLine();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const details = item.details ?? [];
  if (details.length === 0) return null;

  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        data-thesis-details-toggle
      >
        <Icon className="size-3.5" aria-hidden />
        {open ? t("tools.thesisCheck.detail.hide") : t("tools.thesisCheck.detail.show", { count: item.pageTotal || details.length })}
      </button>
      {open ? (
        <div id={listId} className="mt-1.5">
          <ul className="flex max-h-56 flex-col overflow-y-auto rounded-md border text-xs" data-thesis-details>
            {details.map((detail, index) => {
              const line = lineOf(item.id, detail);
              return (
                <li key={`${detail.page}-${index}`} className="flex items-start gap-2 border-b px-2 py-1.5 last:border-b-0" data-thesis-detail-page={detail.page}>
                  <button
                    type="button"
                    onClick={() => openPage(detail.page)}
                    aria-label={t("tools.checkReport.pageList.openPage", { n: detail.page })}
                    className="glass-chip min-w-10 shrink-0 rounded-md px-2 py-0.5 text-center font-mono text-xs text-foreground outline-none transition-colors hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {detail.page}
                  </button>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                    {line.expected || line.found ? (
                      <span className="text-foreground">
                        {line.expected ? t("tools.thesisCheck.detail.expected", { value: line.expected }) : null}
                        {line.expected && line.found ? " · " : null}
                        {line.found ? t("tools.thesisCheck.detail.found", { value: line.found }) : null}
                      </span>
                    ) : null}
                    {line.note ? <span className="text-muted-foreground">{line.note}</span> : null}
                    {line.text ? <span className="truncate text-muted-foreground" title={line.text}>{t("tools.thesisCheck.detail.heading", { text: line.text })}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {item.pageTotal > details.length ? <p className="mt-1 text-xs text-muted-foreground">{t("tools.thesisCheck.detail.truncated", { shown: details.length, total: item.pageTotal })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
