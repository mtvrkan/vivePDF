import { memo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import type { StudioPage } from "@/types/studio";
import { addPage, duplicatePage, movePage, removePage } from "../model/edit";
import type { DropSide } from "./dragSort";
import { PAGE_DROP_ATTRIBUTE, pageLabel, usePageDrag } from "./pageDrag";
import { PageOverview } from "./PageOverview";
import { PageDropLine, PageThumbnail } from "./PageThumbnail";
import { useStudioStore } from "./studioStore";

const THUMB_HEIGHT = 72;

const StripPage = memo(function StripPage({ page, number, current, language, root, drop, dragging }: {
  page: StudioPage;
  number: number;
  current: boolean;
  language: string;
  root: React.RefObject<HTMLElement | null>;
  drop: DropSide | null;
  dragging: boolean;
}) {
  const { t } = useTranslation();
  const label = pageLabel(t, page, number);
  const scale = THUMB_HEIGHT / page.height;
  return (
    <li className={cn("relative shrink-0", dragging && "opacity-50")} {...{ [PAGE_DROP_ATTRIBUTE]: page.id }}>
      {drop ? <PageDropLine side={drop} /> : null}
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        aria-label={label}
        title={label}
        onClick={() => useStudioStore.getState().setPage(page.id)}
        className={cn("relative block overflow-hidden rounded-md ring-offset-2 ring-offset-background", current ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-primary/50")}
      >
        <PageThumbnail page={page} language={language} scale={scale} root={root} margin="0px 480px" />
        <span className="absolute bottom-0.5 right-1 rounded bg-background/80 px-1 text-xs tabular-nums">{number}</span>
      </button>
    </li>
  );
});

export function PagesStrip({ language }: { language: string }) {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const pageId = useStudioStore((state) => state.pageId);
  const apply = useStudioStore((state) => state.apply);
  const setPage = useStudioStore((state) => state.setPage);
  const listRef = useRef<HTMLOListElement>(null);
  const [overview, setOverview] = useState(false);
  const { drag, delegate } = usePageDrag(listRef);
  if (!design) return null;
  const index = Math.max(0, design.pages.findIndex((page) => page.id === pageId));
  const current = design.pages[index];

  const add = () => {
    const result = addPage(design, current.id);
    apply(() => result.design);
    if (result.pageId) setPage(result.pageId);
  };
  const copy = () => {
    const result = duplicatePage(design, current.id);
    apply(() => result.design);
    if (result.pageId) setPage(result.pageId);
  };

  return (
    <div className="glass flex items-center gap-3 border-t border-border/60 px-3 py-2" data-testid="studio-pages">
      <ol ref={listRef} className="flex min-w-0 flex-1 select-none items-center gap-2 overflow-x-auto px-1 py-1" aria-label={t("studio.pages.label")} {...delegate((key) => key)}>
        {design.pages.map((page, position) => (
          <StripPage
            key={page.id}
            page={page}
            number={position + 1}
            current={page.id === current.id}
            language={language}
            root={listRef}
            drop={drag?.target?.key === page.id ? drag.target.side : null}
            dragging={drag?.source === page.id}
          />
        ))}
        <li className="shrink-0">
          <button type="button" onClick={add} aria-label={t("studio.pages.add")} title={t("studio.pages.add")} className="flex h-18 w-12 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary">
            <Plus className="size-5" aria-hidden />
          </button>
        </li>
      </ol>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton icon={LayoutGrid} label={t("studio.pages.overview")} onClick={() => setOverview(true)} />
        <IconButton icon={ChevronLeft} label={t("studio.pages.moveLeft")} disabled={index === 0} onClick={() => apply((value) => movePage(value, current.id, index - 1))} />
        <IconButton icon={ChevronRight} label={t("studio.pages.moveRight")} disabled={index === design.pages.length - 1} onClick={() => apply((value) => movePage(value, current.id, index + 1))} />
        <IconButton icon={Copy} label={t("studio.pages.duplicate")} onClick={copy} />
        <IconButton icon={Trash2} label={t("studio.pages.delete")} disabled={design.pages.length <= 1} onClick={() => apply((value) => removePage(value, current.id))} />
      </div>
      <PageOverview open={overview} onClose={() => setOverview(false)} language={language} />
    </div>
  );
}
