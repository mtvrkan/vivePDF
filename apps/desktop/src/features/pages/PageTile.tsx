import { memo, type MouseEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Scissors } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import type { OrganizerSource, OrganizerTile } from "@/types";
import { PageThumbnail } from "./PageThumbnail";
import { MAIN_SOURCE_ID } from "./organizerStore";

const FOOTER_HEIGHT = 28;

export type TileActions = {
  pointerDown: (event: PointerEvent, key: string) => void;
  click: (event: MouseEvent, key: string) => void;
  check: (event: MouseEvent, key: string) => void;
  open: (tile: OrganizerTile) => void;
  menu: (key: string, x: number, y: number) => void;
  toggleCut: (key: string) => void;
};

type PageTileProps = {
  tile: OrganizerTile;
  position: number;
  total: number;
  isLast: boolean;
  isSelected: boolean;
  isCut: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  dimmed: boolean;
  checkboxShown: boolean;
  labelText: string | null;
  labelStart: boolean;
  sources: Record<string, OrganizerSource>;
  width: number;
  height: number;
  actions: TileActions;
};

export const PageTile = memo(function PageTile({ tile, position, total, isLast, isSelected, isCut, dropBefore, dropAfter, dimmed, checkboxShown, labelText, labelStart, sources, width, height, actions }: PageTileProps) {
  const { t } = useTranslation();
  return (
    <li
      id={`page-tile-${tile.key}`}
      role="option"
      aria-label={t("viewer.reading.page", { page: position + 1 })}
      aria-posinset={position + 1}
      aria-setsize={total}
      data-tile-index={position}
      data-tile-key={tile.key}
      onPointerDown={(event) => actions.pointerDown(event, tile.key)}
      onClick={(event) => actions.click(event, tile.key)}
      onDoubleClick={() => actions.open(tile)}
      onContextMenu={(event) => {
        event.preventDefault();
        actions.menu(tile.key, event.clientX, event.clientY);
      }}
      aria-selected={isSelected}
      className={cn(
        "card group relative flex cursor-default touch-none flex-col gap-1.5 rounded-xl p-2 select-none transition-[transform,box-shadow,border-color] duration-(--transition-fast)",
        "hover:z-10 focus-within:z-10",
        isSelected ? "border-primary ring-4 ring-primary/20" : "hover:-translate-y-0.5 hover:border-primary/40",
        dimmed ? "opacity-40" : "",
      )}
    >
      {dropBefore ? <span aria-hidden className="absolute -start-2 top-1 bottom-1 w-1 rounded-sm bg-primary" /> : null}
      {dropAfter ? <span aria-hidden className="absolute -end-2 top-1 bottom-1 w-1 rounded-sm bg-primary" /> : null}
      {isCut ? <span aria-hidden className="absolute -end-2 top-1 bottom-1 border-e-2 border-dashed border-primary" /> : null}
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        aria-label={t("tools.pages.selectPage", { page: position + 1 })}
        title={t("tools.pages.selectPageHint")}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => actions.check(event, tile.key)}
        className={cn(
          "absolute start-3 top-3 z-10 flex size-6 items-center justify-center rounded-md border shadow-md transition-opacity duration-(--transition-fast) focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected ? "border-primary bg-primary text-primary-foreground opacity-100" : "bg-card text-transparent hover:text-muted-foreground group-hover:opacity-100",
          !isSelected && (checkboxShown ? "opacity-100" : "opacity-0"),
        )}
      >
        <Check className="size-4" aria-hidden />
      </button>
      {isLast ? null : (
        <button
          type="button"
          aria-label={t("tools.pages.cutAfter", { page: position + 1 })}
          aria-pressed={isCut}
          title={t("tools.pages.cutAfter", { page: position + 1 })}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            actions.toggleCut(tile.key);
          }}
          className={cn(
            "absolute -end-4 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-md transition-opacity duration-(--transition-fast) focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isCut ? "border-primary bg-primary text-primary-foreground opacity-100" : "bg-card text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
          )}
        >
          <Scissors className="size-3.5" aria-hidden />
        </button>
      )}
      <div className="flex flex-col gap-1.5" style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${width}px auto ${height + FOOTER_HEIGHT}px` }}>
        <PageThumbnail tile={tile} sources={sources} width={width} height={height} className="rounded-sm" />
        <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">{position + 1}</span>
            {labelText !== null ? (
              <span
                title={t("tools.pages.labels.shown", { label: labelText })}
                className={cn("truncate rounded-full border px-1.5 py-0.5 text-[11px]", labelStart ? "border-primary text-primary" : "text-muted-foreground")}
              >
                {labelText}
              </span>
            ) : null}
          </span>
          <span className="truncate ps-2">
            {tile.kind === "page" && tile.sourceId !== MAIN_SOURCE_ID ? `${sources[tile.sourceId]?.fileName ?? ""} · ${tile.index}` : ""}
            {tile.kind === "page" && tile.sourceId === MAIN_SOURCE_ID && tile.index !== position + 1 ? `← ${tile.index}` : ""}
            {tile.kind === "blank" ? t(tile.paper ? `tools.pages.paper.${tile.paper.style}` : "tools.pages.blank") : ""}
            {tile.kind === "image" ? tile.fileName : ""}
            {tile.rotate ? ` ${tile.rotate}°` : ""}
          </span>
        </div>
      </div>
    </li>
  );
});
