import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, FileOutput, Images, LayoutGrid, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { ThumbImg, ThumbnailsPane, type ThumbMeta } from "@embedpdf/plugin-thumbnail/react";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { basenameOf } from "@/shared/lib/paths";
import { suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { assemblePages } from "@/shared/rpc/operations";
import { renderThumbnail } from "@/shared/rpc/thumbnail";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { useToastStore } from "@/shared/store/toastStore";
import { isPageDeleted, pageRotation } from "./pageEdits";
import { usePageEdits } from "./usePageEdits";

const PAGE_EXPORT_WIDTH = 1600;

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export const PAGE_DRAG_TYPE = "application/x-vivepdf-page";

function turnedFit(width: number, height: number, degrees: number): string | undefined {
  if (degrees === 0) return undefined;
  const scale = degrees % 180 === 0 ? 1 : Math.min(width / height, height / width);
  return `rotate(${degrees}deg) scale(${scale})`;
}

export function ThumbnailSidebar({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const { state, provides: scroll } = useScroll(documentId);
  const { provides: rotate } = useRotate(documentId);
  const asideRef = useRef<HTMLElement>(null);
  const menu = useContextMenu();
  const [menuPageIndex, setMenuPageIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const labels = usePageLabels(documentId);
  const pageEdits = usePageEdits(documentId);

  useEffect(() => {
    const current = asideRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView({ block: "nearest" });
  }, [state.currentPage]);

  const copyPageAsImage = async (pageIndex: number) => {
    if (!document || busy) return;
    setBusy(true);
    try {
      const result = await renderThumbnail({ path: document.path, password: document.password ?? undefined, page: pageIndex, width: PAGE_EXPORT_WIDTH });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": base64ToBlob(result.image, "image/png") })]);
      toast("success", t("viewer.context.imageCopied"));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const extractPageAsPdf = async (pageIndex: number) => {
    if (!document || busy) return;
    const suggested = suggestOutputPath(document.path, `${t("viewer.context.imageSuffix")}-${pageIndex + 1}`);
    const chosen = await saveDialog({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!chosen) return;
    setBusy(true);
    try {
      await assemblePages({
        sources: [{ id: "main", path: document.path, password: document.password ?? undefined }],
        pages: [{ kind: "page", source: "main", index: pageIndex + 1, rotate: 0 }],
        output: chosen,
        overwrite: true,
      });
      toast("success", t("viewer.context.pageExtracted", { name: basenameOf(chosen) }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const menuItems: ContextMenuItem[] =
    menuPageIndex === null
      ? []
      : [
          { type: "item", id: "go-to-page", label: t("viewer.context.goToPage"), onSelect: () => scroll?.scrollToPage({ pageNumber: menuPageIndex + 1 }) },
          { type: "item", id: "rotate-forward", icon: RotateCw, label: t("viewer.context.rotateViewForward"), onSelect: () => rotate?.rotateForward() },
          { type: "item", id: "extract-page", icon: FileOutput, label: t("viewer.context.extractPage"), disabled: busy, onSelect: () => void extractPageAsPdf(menuPageIndex) },
          { type: "item", id: "copy-page-image", icon: Images, label: t("viewer.context.copyPageImage"), disabled: busy, onSelect: () => void copyPageAsImage(menuPageIndex) },
          { type: "separator", id: "sep-page-edits" },
          { type: "item", id: "rotate-page-right", icon: RotateCw, label: t("viewer.pageEdits.rotateRight"), onSelect: () => pageEdits.rotate(menuPageIndex, 90) },
          { type: "item", id: "rotate-page-left", icon: RotateCcw, label: t("viewer.pageEdits.rotateLeft"), onSelect: () => pageEdits.rotate(menuPageIndex, -90) },
          isPageDeleted(pageEdits.edits, menuPageIndex)
            ? { type: "item", id: "restore-page", icon: ArchiveRestore, label: t("viewer.pageEdits.restore"), onSelect: () => pageEdits.toggleDelete(menuPageIndex) }
            : { type: "item", id: "delete-page", icon: Trash2, label: t("viewer.pageEdits.delete"), shortcut: "Del", disabled: !pageEdits.canDelete(menuPageIndex), onSelect: () => pageEdits.toggleDelete(menuPageIndex) },
          { type: "item", id: "open-organizer", icon: LayoutGrid, label: t("viewer.pageEdits.openOrganizer"), onSelect: () => void navigate("/pages") },
        ];

  return (
    <aside ref={asideRef} aria-label={t("viewer.thumbnails")} className="glass-flat relative h-full w-48 overflow-hidden border-e">
      <ThumbnailsPane documentId={documentId} style={{ height: "100%" }}>
        {(meta: ThumbMeta) => {
          const active = meta.pageIndex + 1 === state.currentPage;
          const deleted = isPageDeleted(pageEdits.edits, meta.pageIndex);
          const turn = pageRotation(pageEdits.edits, meta.pageIndex);
          const pageName = t("viewer.reading.page", { page: meta.pageIndex + 1 });
          const status = [deleted ? t("viewer.pageEdits.markedDeleted") : null, turn ? t("viewer.pageEdits.markedRotated", { degrees: turn }) : null].filter(Boolean);
          return (
            <div key={meta.pageIndex} style={{ position: "absolute", top: meta.top, height: meta.wrapperHeight, width: "100%" }} className="group">
              <button
                type="button"
                onClick={() => scroll?.scrollToPage({ pageNumber: meta.pageIndex + 1, behavior: "instant" })}
                onKeyDown={(event) => {
                  if (event.key === "Delete") {
                    event.preventDefault();
                    event.stopPropagation();
                    pageEdits.toggleDelete(meta.pageIndex);
                  } else if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    pageEdits.rotate(meta.pageIndex, event.shiftKey ? -90 : 90);
                  }
                }}
                onContextMenu={(event) => {
                  setMenuPageIndex(meta.pageIndex);
                  menu.open(event);
                }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(PAGE_DRAG_TYPE, JSON.stringify({ documentId, page: meta.pageIndex + 1 }));
                  event.dataTransfer.effectAllowed = "copy";
                }}
                aria-current={active ? "page" : undefined}
                aria-label={[pageName, ...status].join(", ")}
                aria-keyshortcuts="Delete R Shift+R"
                className="flex size-full flex-col items-center gap-1 px-3"
              >
                <span
                  style={{ width: meta.width, height: meta.height }}
                  className={cn("relative overflow-hidden rounded-md border-2 bg-background shadow-(--shadow-card) transition-[box-shadow,border-color] duration-(--transition-fast)", active ? "border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_28%,transparent)]" : "border-transparent hover:border-primary/40", deleted && "border-dashed border-destructive/60")}
                >
                  <span className={cn("block size-full transition-transform duration-(--transition-fast)", deleted && "opacity-35 grayscale")} style={{ transform: turnedFit(meta.width, meta.height, turn) }}>
                    <ThumbImg documentId={documentId} meta={meta} role="presentation" style={{ width: "100%", height: "100%" }} />
                  </span>
                  {deleted ? (
                    <span data-testid="thumbnail-deleted-badge" className="absolute start-1 bottom-1 inline-flex size-6 items-center justify-center rounded-md bg-destructive text-destructive-foreground" aria-hidden>
                      <Trash2 className="size-3.5" />
                    </span>
                  ) : null}
                  {turn ? (
                    <span data-testid="thumbnail-rotation-badge" className="absolute end-1 bottom-1 rounded-md bg-primary px-1 text-xs font-semibold tabular-nums text-primary-foreground" aria-hidden>
                      {turn}°
                    </span>
                  ) : null}
                </span>
                <span className={cn("rounded-md px-1.5 text-xs tabular-nums", active ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground", deleted && "line-through")}>
                  {pageLabelOf(labels, meta.pageIndex + 1)}
                </span>
              </button>
              <div
                className={cn("absolute top-1 flex gap-0.5 transition-opacity duration-(--transition-fast) group-hover:opacity-100 group-focus-within:opacity-100", deleted ? "opacity-100" : "opacity-0")}
                style={{ insetInlineEnd: `calc(50% - ${meta.width / 2}px + 4px)` }}
              >
                <IconButton
                  icon={RotateCw}
                  label={t("viewer.pageEdits.rotateRightPage", { page: meta.pageIndex + 1 })}
                  className="size-6 rounded-md bg-background/90"
                  onClick={(event) => {
                    event.stopPropagation();
                    pageEdits.rotate(meta.pageIndex, 90);
                  }}
                />
                <IconButton
                  icon={deleted ? ArchiveRestore : Trash2}
                  label={deleted ? t("viewer.pageEdits.restorePage", { page: meta.pageIndex + 1 }) : t("viewer.pageEdits.deletePage", { page: meta.pageIndex + 1 })}
                  disabled={!deleted && !pageEdits.canDelete(meta.pageIndex)}
                  className={cn("size-6 rounded-md bg-background/90", !deleted && "hover:text-destructive")}
                  onClick={(event) => {
                    event.stopPropagation();
                    pageEdits.toggleDelete(meta.pageIndex);
                  }}
                />
              </div>
            </div>
          );
        }}
      </ThumbnailsPane>
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={menuItems} label={t("viewer.context.title")} onClose={menu.close} /> : null}
    </aside>
  );
}
