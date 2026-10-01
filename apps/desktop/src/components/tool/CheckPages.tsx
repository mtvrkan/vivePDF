import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOpenAtPage } from "@/shared/hooks/useOpenAtPage";

export const PAGE_LIST_LIMIT = 200;

export function CheckPages({ path, pages }: { path: string; pages: number[] }) {
  const { t } = useTranslation();
  const openPage = useOpenAtPage(path);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (pages.length === 0) return null;

  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5" aria-hidden />
        {open ? t("tools.checkReport.pageList.hide") : t("tools.checkReport.pageList.show", { count: pages.length })}
      </button>
      {open ? (
        <div id={listId} className="mt-1.5">
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {pages.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => openPage(page)}
                aria-label={t("tools.checkReport.pageList.openPage", { n: page })}
                className="glass-chip rounded-md px-2 py-0.5 font-mono text-xs text-foreground outline-none transition-colors hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
              >
                {page}
              </button>
            ))}
          </div>
          {pages.length >= PAGE_LIST_LIMIT ? <p className="mt-1 text-xs text-muted-foreground">{t("tools.checkReport.pageList.truncated", { limit: PAGE_LIST_LIMIT })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
