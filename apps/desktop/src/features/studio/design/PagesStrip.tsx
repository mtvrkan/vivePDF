import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { addPage, duplicatePage, movePage, removePage } from "../model/edit";
import { PageView } from "./ElementView";
import { useStudioStore } from "./studioStore";

const THUMB_HEIGHT = 72;

export function PagesStrip({ language }: { language: string }) {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const pageId = useStudioStore((state) => state.pageId);
  const apply = useStudioStore((state) => state.apply);
  const setPage = useStudioStore((state) => state.setPage);
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
      <ol className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1" aria-label={t("studio.pages.label")}>
        {design.pages.map((page, position) => {
          const scale = THUMB_HEIGHT / page.height;
          return (
            <li key={page.id} className="shrink-0">
              <button
                type="button"
                aria-current={page.id === current.id ? "page" : undefined}
                aria-label={t("studio.pages.page", { number: position + 1 })}
                onClick={() => setPage(page.id)}
                className={cn("relative block overflow-hidden rounded-md ring-offset-2 ring-offset-background", page.id === current.id ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-primary/50")}
                style={{ width: `${page.width * scale}px`, height: `${THUMB_HEIGHT}px` }}
              >
                <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }} aria-hidden>
                  <PageView page={page} language={language} />
                </span>
                <span className="absolute bottom-0.5 right-1 rounded bg-background/80 px-1 text-xs tabular-nums">{position + 1}</span>
              </button>
            </li>
          );
        })}
        <li className="shrink-0">
          <button type="button" onClick={add} aria-label={t("studio.pages.add")} title={t("studio.pages.add")} className="flex h-18 w-12 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary">
            <Plus className="size-5" aria-hidden />
          </button>
        </li>
      </ol>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton icon={ChevronLeft} label={t("studio.pages.moveLeft")} disabled={index === 0} onClick={() => apply((value) => movePage(value, current.id, index - 1))} />
        <IconButton icon={ChevronRight} label={t("studio.pages.moveRight")} disabled={index === design.pages.length - 1} onClick={() => apply((value) => movePage(value, current.id, index + 1))} />
        <IconButton icon={Copy} label={t("studio.pages.duplicate")} onClick={copy} />
        <IconButton icon={Trash2} label={t("studio.pages.delete")} disabled={design.pages.length <= 1} onClick={() => apply((value) => removePage(value, current.id))} />
      </div>
    </div>
  );
}
