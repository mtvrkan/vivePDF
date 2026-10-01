import { useEffect, useState, type KeyboardEvent } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Image as ImageIcon, Layers as LayersIcon, Lock, Trash2, Type, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { layerKey } from "./layers";
import { DRAWING_SPECS, drawingLayerLabel } from "./drawing/drawingKinds";
import { isDrawingImage } from "./drawing/drawingSource";
import { isPendingChange } from "./pending";
import type { EditorBlockInfo } from "@/types";

type LayerFilter = "all" | "text" | "image";
type LayerRow = { key: string; area: number } & ({ source: "pending"; item: EditorPending } | { source: "block"; block: EditorBlockInfo });

function blockArea(block: EditorBlockInfo): number {
  return (block.bbox[2] - block.bbox[0]) * (block.bbox[3] - block.bbox[1]);
}

function rowKind(row: LayerRow): "text" | "image" {
  if (row.source === "block") return row.block.kind;
  return row.item.kind === "image" || row.item.kind === "imageChange" ? "image" : "text";
}

export function LayersPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const scroll = useScroll(documentId);
  const objects = useViewerOverlayStore((state) => state.objects);
  const blocksByPage = useViewerOverlayStore((state) => state.blocksByPage);
  const selectedObjectId = useViewerOverlayStore((state) => state.selectedObjectId);
  const hiddenLayerKeys = useViewerOverlayStore((state) => state.hiddenLayerKeys);
  const lockedLayerKeys = useViewerOverlayStore((state) => state.lockedLayerKeys);
  const store = useViewerOverlayStore.getState();
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<LayerFilter>("all");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const selected = objects.find((item) => item.id === selectedObjectId) ?? null;
  const knownPages = Object.keys(blocksByPage)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const fallbackPage = selected ? selected.pageIndex : knownPages.length > 0 ? Math.min(...knownPages) : 0;
  const scrollPage = scroll.state.currentPage;
  const pageIndex = Number.isFinite(scrollPage) && scrollPage > 0 ? scrollPage - 1 : fallbackPage;

  const claimedBlockIds = new Set(
    objects.filter((item) => item.pageIndex === pageIndex && (item.kind === "block" || item.kind === "imageChange")).map((item) => (item as { blockId: string }).blockId),
  );
  const pageObjects = objects.filter((item) => item.pageIndex === pageIndex);
  const pageBlocks = (blocksByPage[pageIndex] ?? []).filter((block) => !claimedBlockIds.has(block.id));

  const rows: LayerRow[] = [
    ...pageObjects.map((item) => ({ source: "pending" as const, key: layerKey(pageIndex, item.id), item, area: item.width * item.height })),
    ...pageBlocks.map((block) => ({ source: "block" as const, key: layerKey(pageIndex, block.id), block, area: blockArea(block) })),
  ].sort((a, b) => a.area - b.area);

  const filteredRows = rows.filter((row) => filter === "all" || rowKind(row) === filter);

  useEffect(() => {
    setActiveIndex(null);
  }, [pageIndex]);

  const labelFor = (row: LayerRow): string => {
    if (row.source === "block") {
      if (row.block.kind === "image") return t("viewer.editPanel.layers.image", { width: Math.round(row.block.bbox[2] - row.block.bbox[0]), height: Math.round(row.block.bbox[3] - row.block.bbox[1]) });
      return row.block.text.replace(/\s+/g, " ").trim().slice(0, 40) || t("viewer.editPanel.layers.emptyText");
    }
    if (isDrawingImage(row.item)) return drawingLayerLabel(row.item.drawing, t);
    if (row.item.kind === "image" || row.item.kind === "imageChange") return t("viewer.editPanel.layers.image", { width: Math.round(row.item.width), height: Math.round(row.item.height) });
    return (row.item.text || "").replace(/\s+/g, " ").trim().slice(0, 40) || t("viewer.editPanel.layers.emptyText");
  };

  const badgeFor = (row: LayerRow): "new" | "changed" | null => {
    if (row.source !== "pending") return null;
    if (row.item.kind === "text" || row.item.kind === "image") return "new";
    if (isPendingChange(row.item)) return "changed";
    return null;
  };

  const focusRow = (row: LayerRow) => {
    if (row.source === "pending") {
      store.setSelectedObject(row.item.id);
    } else {
      const [x0, y0, x1, y1] = row.block.bbox;
      store.requestFocusAt({ page: pageIndex + 1, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    }
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-layer-key="${row.key.replace(/"/g, '\\"')}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const deleteRow = (row: LayerRow) => {
    if (row.source !== "pending") return;
    store.snapshot();
    store.removeObject(row.item.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (filteredRows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = activeIndex === null ? 0 : Math.min(filteredRows.length - 1, activeIndex + 1);
      setActiveIndex(next);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = activeIndex === null ? filteredRows.length - 1 : Math.max(0, activeIndex - 1);
      setActiveIndex(next);
      return;
    }
    if (activeIndex === null) return;
    const row = filteredRows[activeIndex];
    if (!row) return;
    if (event.key === "Enter") {
      event.preventDefault();
      focusRow(row);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteRow(row);
      return;
    }
    if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      store.toggleLayerHidden(row.key);
      return;
    }
    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      store.toggleLayerLocked(row.key);
    }
  };

  const filters: Array<{ value: LayerFilter; label: string }> = [
    { value: "all", label: t("viewer.editPanel.layers.filterAll") },
    { value: "text", label: t("viewer.editPanel.layers.filterText") },
    { value: "image", label: t("viewer.editPanel.layers.filterImage") },
  ];

  return (
    <section className="border-b px-3 py-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mb-2 flex w-full items-center gap-1.5 text-xs font-medium">
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
        <LayersIcon className="size-3.5 text-primary" aria-hidden />
        <span className="flex-1 text-start">{t("viewer.editPanel.layers.title")}</span>
      </button>
      {open ? (
        <>
          <div className="mb-2 flex items-center gap-1">
            {filters.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={filter === entry.value}
                onClick={() => setFilter(entry.value)}
                className={cn("nav-glass whitespace-nowrap rounded-full px-2 py-0.5 text-xs", filter === entry.value && "glass-chip text-primary")}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {filteredRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("viewer.editPanel.layers.empty")}</p>
          ) : (
            <ul className="space-y-1" onKeyDown={onKeyDown} tabIndex={0}>
              {filteredRows.map((row, index) => {
                const kind = rowKind(row);
                const Icon = row.source === "pending" && isDrawingImage(row.item) ? DRAWING_SPECS[row.item.drawing.kind].icon : kind === "image" ? ImageIcon : Type;
                const isSelected = row.source === "pending" && row.item.id === selectedObjectId;
                const isActive = index === activeIndex;
                const hidden = Boolean(hiddenLayerKeys[row.key]);
                const locked = Boolean(lockedLayerKeys[row.key]);
                const badge = badgeFor(row);
                return (
                  <li
                    key={row.key}
                    className={cn("nav-glass flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs", (isSelected || isActive) && "glass-chip")}
                    onMouseEnter={() => store.setHoveredLayerKey(row.key)}
                    onMouseLeave={() => store.setHoveredLayerKey(null)}
                  >
                    <button type="button" onClick={() => { setActiveIndex(index); focusRow(row); }} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span title={labelFor(row)} className="min-w-0 flex-1 truncate">{labelFor(row)}</span>
                      {badge ? <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">{t(`viewer.editPanel.layers.${badge}`)}</span> : null}
                    </button>
                    <IconButton
                      icon={hidden ? EyeOff : Eye}
                      label={hidden ? t("viewer.editPanel.layers.show") : t("viewer.editPanel.layers.hide")}
                      active={hidden}
                      onClick={() => store.toggleLayerHidden(row.key)}
                    />
                    <IconButton
                      icon={locked ? Lock : Unlock}
                      label={locked ? t("viewer.editPanel.layers.unlock") : t("viewer.editPanel.layers.lock")}
                      active={locked}
                      onClick={() => store.toggleLayerLocked(row.key)}
                    />
                    {row.source === "pending" ? <IconButton icon={Trash2} label={t("viewer.editPanel.revert")} onClick={() => deleteRow(row)} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
