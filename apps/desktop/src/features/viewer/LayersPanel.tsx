import { useState } from "react";
import { Eye, EyeOff, Layers, Lock, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { cn } from "@/shared/lib/cn";
import { readOriginalSource } from "@/shared/session/viewSources";
import { useDocumentStore } from "@/shared/store/documentStore";
import { chooseLayer, hasLayers, layerChoiceList, layerShown, useLayerViewStore } from "@/shared/store/layerViewStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import type { LayerRow } from "@/types";
import { loadLayers } from "./useLayerCheck";
import { useDocumentSave } from "./useDocumentSave";
import { useOpenPdf } from "./useOpenPdf";
import { preparedViewSource } from "./viewableBytes";

const INDENTS = ["ps-2", "ps-6", "ps-10", "ps-14"];
const NO_ROWS: LayerRow[] = [];

export function LayersPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const list = useLayerViewStore((state) => state.lists[documentId]);
  const choices = useLayerViewStore((state) => (document ? state.choices[document.path] : undefined));
  const { unsavedCount } = useDocumentSave(documentId);
  const { replaceDocument } = useOpenPdf();
  const { state: scrollState } = useScroll(documentId);
  const [busy, setBusy] = useState(false);
  const rows = list?.state === "listed" ? list.rows : NO_ROWS;

  const reload = () => {
    if (document) void loadLayers(document.id, document.path, document.password);
  };

  const showLayers = async (next: Record<number, boolean>) => {
    if (!document || busy) return;
    if (unsavedCount() > 0) {
      toast("error", t("viewer.layers.saveFirst"));
      return;
    }
    setBusy(true);
    const store = useLayerViewStore.getState();
    const previous = store.choices[document.path] ?? {};
    try {
      const layers = layerChoiceList(next);
      const password = document.password ?? undefined;
      const source = (await preparedViewSource(document.path, password, layers)) ?? (layers.length === 0 ? await readOriginalSource(document.path) : null);
      if (!source) {
        toast("error", t("viewer.layers.switchFailed"));
        return;
      }
      const page = scrollState.currentPage;
      store.setChoices(document.path, next);
      if (!(await replaceDocument(documentId, source))) {
        store.setChoices(document.path, previous);
        toast("error", t("viewer.layers.switchFailed"));
        return;
      }
      if (page > 1) useViewerJumpStore.getState().request({ path: document.path, page });
    } catch {
      store.setChoices(document.path, previous);
      toast("error", t("viewer.layers.switchFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label={t("viewer.layers.title")} aria-busy={busy || undefined} className="flex h-full w-inspector flex-col border-e bg-card">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <Layers className="size-4 text-primary" aria-hidden />
        <span className="flex-1 text-sm font-semibold">{t("viewer.layers.title")}</span>
        <IconButton icon={RotateCcw} label={t("viewer.layers.reset")} disabled={busy || !choices} onClick={() => void showLayers({})} />
        <IconButton icon={RefreshCw} label={t("viewer.layers.refresh")} disabled={busy || list?.state === "loading"} onClick={reload} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!list || list.state === "loading" ? <SkeletonCard lines={4} /> : null}
        {list?.state === "failed" ? <ErrorState title={t("viewer.layers.failed")} message={t("viewer.layers.failedHint")} onRetry={reload} /> : null}
        {list?.state === "listed" && !hasLayers(list) ? <EmptyState icon={Layers} title={t("viewer.layers.none")} description={t("viewer.layers.noneHint")} /> : null}
        <ul className="flex flex-col gap-0.5">
          {rows.map((row, index) => {
            const indent = INDENTS[Math.min(row.depth, INDENTS.length - 1)];
            if (row.id === null) {
              return (
                <li key={`label-${index}`} className={cn("pt-2 pb-1 text-[11px] font-semibold text-muted-foreground", indent)}>
                  {row.name}
                </li>
              );
            }
            const id = row.id;
            const shown = layerShown(row, choices);
            const changed = choices?.[id] !== undefined;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-layer-id={id}
                  aria-pressed={shown}
                  aria-label={t(shown ? "viewer.layers.hide" : "viewer.layers.show", { name: row.name })}
                  title={row.locked ? t("viewer.layers.locked") : undefined}
                  disabled={busy || row.locked}
                  onClick={() => void showLayers(chooseLayer(rows, choices, id, !shown))}
                  className={cn("flex w-full items-center gap-2 rounded-lg py-1.5 pe-2 text-start text-sm hover:bg-secondary disabled:opacity-60", indent)}
                >
                  {shown ? <Eye className="size-4 shrink-0 text-primary" aria-hidden /> : <EyeOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className={cn("min-w-0 flex-1 truncate", shown ? "" : "text-muted-foreground")}>{row.name}</span>
                  {changed ? <span className="glass-chip shrink-0 text-[10px] text-muted-foreground">{t("viewer.layers.changed")}</span> : null}
                  {row.locked ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("viewer.layers.hint")}</p>
    </aside>
  );
}
