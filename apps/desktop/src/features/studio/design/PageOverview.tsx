import { memo, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import type { StudioPage } from "@/types/studio";
import { movePage } from "../model/pages";
import type { DropSide } from "./dragSort";
import { PAGE_DROP_ATTRIBUTE, pageLabel, usePageDrag } from "./pageDrag";
import { PageDropLine, PageThumbnail } from "./PageThumbnail";
import { useStudioStore } from "./studioStore";

const TILE_SIDE = 136;

const OverviewTile = memo(function OverviewTile({ page, number, count, current, language, drop, dragging, onPick }: {
  page: StudioPage;
  number: number;
  count: number;
  current: boolean;
  language: string;
  drop: DropSide | null;
  dragging: boolean;
  onPick: (pageId: string) => void;
}) {
  const { t } = useTranslation();
  const label = pageLabel(t, page, number);
  const scale = TILE_SIDE / Math.max(page.width, page.height);
  const move = (index: number) => useStudioStore.getState().apply((design) => movePage(design, page.id, index));
  return (
    <li className={cn("relative flex flex-col gap-1.5", dragging && "opacity-50")} {...{ [PAGE_DROP_ATTRIBUTE]: page.id }}>
      {drop ? <PageDropLine side={drop} /> : null}
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        aria-label={label}
        title={label}
        data-page-tile={page.id}
        onClick={() => onPick(page.id)}
        className={cn(
          "flex h-40 items-center justify-center rounded-lg bg-muted/40 p-2 outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
          current ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-primary/50",
        )}
      >
        <span className="block overflow-hidden rounded-sm shadow-sm">
          <PageThumbnail page={page} language={language} scale={scale} root={null} margin="240px" />
        </span>
      </button>
      <div className="flex min-w-0 items-center gap-1">
        <IconButton icon={ChevronLeft} className="size-7 rtl:-scale-x-100" label={t("studio.pages.moveEarlier", { number })} disabled={number === 1} onClick={() => move(number - 2)} />
        <span className="min-w-0 flex-1 truncate text-center text-xs">
          <span className="font-mono tabular-nums text-muted-foreground">{number}</span>
          {page.name ? <span className="ms-1.5 font-medium">{page.name}</span> : null}
        </span>
        <IconButton icon={ChevronRight} className="size-7 rtl:-scale-x-100" label={t("studio.pages.moveLater", { number })} disabled={number === count} onClick={() => move(number)} />
      </div>
    </li>
  );
});

export function PageOverview({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const pages = useStudioStore((state) => state.design?.pages ?? null);
  const pageId = useStudioStore((state) => state.pageId);
  const listRef = useRef<HTMLOListElement>(null);
  const { drag, delegate } = usePageDrag(listRef);
  const close = useRef(onClose);
  close.current = onClose;
  const pick = useCallback((id: string) => {
    useStudioStore.getState().setPage(id);
    close.current();
  }, []);
  return (
    <Dialog open={open && pages !== null} title={t("studio.pages.overview")} onClose={onClose} size="xl">
      <p className="mb-3 text-sm text-muted-foreground">{t("studio.pages.overviewHint")}</p>
      <ol ref={listRef} aria-label={t("studio.pages.label")} className="grid select-none grid-cols-2 gap-x-4 gap-y-3 pb-1 sm:grid-cols-3 md:grid-cols-5" {...delegate((key) => key)}>
        {(pages ?? []).map((page, position) => (
          <OverviewTile
            key={page.id}
            page={page}
            number={position + 1}
            count={pages?.length ?? 0}
            current={page.id === (pageId ?? pages?.[0]?.id)}
            language={language}
            drop={drag?.target?.key === page.id ? drag.target.side : null}
            dragging={drag?.source === page.id}
            onPick={pick}
          />
        ))}
      </ol>
    </Dialog>
  );
}
