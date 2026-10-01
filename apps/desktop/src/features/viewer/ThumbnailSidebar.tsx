import { useEffect, useRef, useState } from "react";
import { FileOutput, Images, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { ThumbImg, ThumbnailsPane, type ThumbMeta } from "@embedpdf/plugin-thumbnail/react";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
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

const PAGE_EXPORT_WIDTH = 1600;

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export const PAGE_DRAG_TYPE = "application/x-vivepdf-page";

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
          { type: "separator", id: "sep-delete" },
          { type: "item", id: "delete-page", icon: Trash2, label: t("viewer.context.deletePage"), onSelect: () => void navigate("/pages") },
        ];

  return (
    <aside ref={asideRef} aria-label={t("viewer.thumbnails")} className="glass-flat relative h-full w-48 overflow-hidden border-e">
      <ThumbnailsPane documentId={documentId} style={{ height: "100%" }}>
        {(meta: ThumbMeta) => {
          const active = meta.pageIndex + 1 === state.currentPage;
          return (
            <button
              key={meta.pageIndex}
              type="button"
              onClick={() => scroll?.scrollToPage({ pageNumber: meta.pageIndex + 1, behavior: "instant" })}
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
              aria-label={t("viewer.reading.page", { page: meta.pageIndex + 1 })}
              style={{ position: "absolute", top: meta.top, height: meta.wrapperHeight, width: "100%" }}
              className="flex flex-col items-center gap-1 px-3"
            >
              <span
                style={{ width: meta.width, height: meta.height }}
                className={cn("overflow-hidden rounded-md border-2 bg-background shadow-(--shadow-card) transition-[box-shadow,border-color] duration-(--transition-fast)", active ? "border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_28%,transparent)]" : "border-transparent hover:border-primary/40")}
              >
                <ThumbImg documentId={documentId} meta={meta} role="presentation" style={{ width: "100%", height: "100%" }} />
              </span>
              <span className={cn("rounded-md px-1.5 text-xs tabular-nums", active ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>
                {pageLabelOf(labels, meta.pageIndex + 1)}
              </span>
            </button>
          );
        }}
      </ThumbnailsPane>
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={menuItems} label={t("viewer.context.title")} onClose={menu.close} /> : null}
    </aside>
  );
}
