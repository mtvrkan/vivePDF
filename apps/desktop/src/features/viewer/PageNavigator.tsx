import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { pageFromInput, pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { usePageNavigation } from "./usePageNavigation";

export function PageNavigator({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const { jumpTo } = usePageNavigation(documentId);
  const labels = usePageLabels(documentId);
  const currentLabel = pageLabelOf(labels, scrollState.currentPage);
  const [pageInput, setPageInput] = useState(currentLabel);

  useEffect(() => {
    setPageInput(currentLabel);
  }, [currentLabel]);

  const goToPage = () => {
    const page = pageFromInput(pageInput, labels, scrollState.totalPages);
    if (page !== null && page !== scrollState.currentPage) jumpTo(page);
    else setPageInput(currentLabel);
  };

  return (
    <nav
      aria-label={t("viewer.pageNavigation")}
      data-testid="page-navigator"
      className="glass-menu absolute end-4 bottom-4 z-30 flex flex-col items-center gap-1 rounded-xl p-1"
    >
      <IconButton icon={ChevronUp} label={t("viewer.previousPage")} disabled={scrollState.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage()} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          goToPage();
        }}
        className="flex flex-col items-center gap-0.5 font-mono text-sm tabular-nums"
      >
        <input
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={goToPage}
          aria-label={t("viewer.pageNumber")}
          inputMode={labels ? "text" : "numeric"}
          className={cn("field-inline h-7 rounded-md text-center", labels ? "w-14" : "w-12")}
        />
        <span className="max-w-14 truncate text-xs text-muted-foreground" title={labels ? `${scrollState.currentPage} / ${scrollState.totalPages}` : undefined}>
          {labels ? `(${scrollState.currentPage} / ${scrollState.totalPages})` : `/ ${scrollState.totalPages}`}
        </span>
      </form>
      <IconButton icon={ChevronDown} label={t("viewer.nextPage")} disabled={scrollState.currentPage >= scrollState.totalPages} onClick={() => scroll?.scrollToNextPage()} />
    </nav>
  );
}
