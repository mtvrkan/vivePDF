import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { IconButton } from "@/components/shared/IconButton";
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
    <div role="group" aria-label={t("viewer.pageNavigation")} data-testid="page-navigator" className="flex flex-col items-center gap-1.5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          goToPage();
        }}
        className="flex flex-col items-center gap-1.5 font-mono tabular-nums"
      >
        <input
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={goToPage}
          aria-label={t("viewer.pageNumber")}
          inputMode={labels ? "text" : "numeric"}
          className="field-inline h-8 w-9 rounded-md px-0.5 text-center text-xs"
        />
        {labels ? (
          <span data-testid="page-position" className="flex flex-col items-center text-[10px] leading-3 whitespace-nowrap text-muted-foreground" title={`${scrollState.currentPage} / ${scrollState.totalPages}`}>
            <span>{scrollState.currentPage}</span>
            <span>/{scrollState.totalPages}</span>
          </span>
        ) : (
          <span data-testid="page-count" className="text-xs whitespace-nowrap text-muted-foreground" title={`${scrollState.currentPage} / ${scrollState.totalPages}`}>
            {scrollState.totalPages}
          </span>
        )}
      </form>
      <IconButton icon={ChevronUp} label={t("viewer.previousPage")} disabled={scrollState.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage()} />
      <IconButton icon={ChevronDown} label={t("viewer.nextPage")} disabled={scrollState.currentPage >= scrollState.totalPages} onClick={() => scroll?.scrollToNextPage()} />
    </div>
  );
}
