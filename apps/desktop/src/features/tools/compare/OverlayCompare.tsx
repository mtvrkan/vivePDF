import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { Segmented, SliderField } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { comparePageImages } from "@/shared/rpc/operations";
import type { ComparePageImagesResult, PageDiff, SourceDocument } from "@/types";
import { isChanged, pageLabel } from "./changeFilter";
import { alignedRows, changePosition, nextChange } from "./pageAlignment";

type Blend = "fade" | "difference";
const BLENDS: Blend[] = ["fade", "difference"];

type OverlayCompareProps = {
  active: boolean;
  sourceA: SourceDocument;
  sourceB: SourceDocument;
  pages: PageDiff[] | null;
  viewSwitch: ReactNode;
};

type Loaded = { key: string; images: ComparePageImagesResult | null; error: string | null };

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export function OverlayCompare({ active, sourceA, sourceB, pages, viewSwitch }: OverlayCompareProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => alignedRows(pages, sourceA.info?.pageCount ?? 0, sourceB.info?.pageCount ?? 0), [pages, sourceA.info?.pageCount, sourceB.info?.pageCount]);
  const changes = useMemo(() => (pages ?? []).filter(isChanged).map((page) => ({ row: page.page })), [pages]);
  const [index, setIndex] = useState(0);
  const [blend, setBlend] = useState<Blend>("fade");
  const [opacity, setOpacity] = useState(50);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const safeIndex = Math.min(index, Math.max(0, rows.length - 1));
  const row = rows[safeIndex] ?? null;
  const key = row ? `${sourceA.path}|${sourceB.path}|${row.a}|${row.b}|${attempt}` : "";

  useEffect(() => {
    setIndex(0);
  }, [sourceA.path, sourceB.path, pages]);

  useEffect(() => {
    if (!active || !row) return;
    const controller = new AbortController();
    comparePageImages(
      {
        pathA: sourceA.path,
        passwordA: sourceA.password ?? undefined,
        pathB: sourceB.path,
        passwordB: sourceB.password ?? undefined,
        pageA: row.a ?? undefined,
        pageB: row.b ?? undefined,
      },
      { signal: controller.signal },
    ).then(
      (images) => {
        if (!controller.signal.aborted) setLoaded({ key, images, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, images: null, error: describeError(t, toRpcError(error)) });
      },
    );
    return () => controller.abort();
  }, [active, key, row, sourceA.path, sourceA.password, sourceB.path, sourceB.password, t]);

  const move = (step: number) => setIndex((current) => Math.min(rows.length - 1, Math.max(0, current + step)));
  const currentRow = row?.row ?? 0;
  const previous = nextChange(changes, currentRow, -1);
  const next = nextChange(changes, currentRow, 1);
  const position = changePosition(changes, currentRow);
  const jumpToRow = (target: number) => {
    const found = rows.findIndex((item) => item.row === target);
    if (found >= 0) setIndex(found);
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => Math.min(rows.length - 1, current + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, rows.length]);

  const current = loaded && loaded.key === key ? loaded : null;
  const images = current?.images ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-topbar flex-wrap items-center gap-1 glass-flat border-b px-2 py-1">
        {viewSwitch}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={ChevronLeft} label={t("tools.compare.sideBySide.overlay.previousPage")} disabled={safeIndex === 0} onClick={() => move(-1)} />
        <span className="min-w-16 text-center font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {t("tools.compare.sideBySide.overlay.row", { current: safeIndex + 1, total: rows.length })}
        </span>
        <IconButton icon={ChevronRight} label={t("tools.compare.sideBySide.overlay.nextPage")} disabled={safeIndex >= rows.length - 1} onClick={() => move(1)} />
        {row ? <span className="px-1 font-mono text-xs text-foreground">{pageLabel(row.a, row.b)}</span> : null}
        {changes.length > 0 ? (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <IconButton icon={ChevronUp} label={t("tools.compare.sideBySide.previousChange")} disabled={!previous} onClick={() => previous && jumpToRow(previous.row)} />
            <span className="min-w-16 text-center font-mono text-xs tabular-nums text-muted-foreground">
              {position > 0 ? t("tools.compare.sideBySide.changeOf", { current: position, total: changes.length }) : t("tools.compare.sideBySide.changeCount", { count: changes.length })}
            </span>
            <IconButton icon={ChevronDown} label={t("tools.compare.sideBySide.nextChange")} disabled={!next} onClick={() => next && jumpToRow(next.row)} />
          </>
        ) : null}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Segmented size="sm" value={blend} options={BLENDS} labelOf={(option) => t(`tools.compare.sideBySide.overlay.blends.${option}`)} onChange={setBlend} ariaLabel={t("tools.compare.sideBySide.overlay.blend")} />
        {blend === "fade" ? (
          <SliderField className="w-48" label={t("tools.compare.sideBySide.overlay.opacity")} value={opacity} min={0} max={100} step={5} onChange={setOpacity} format={(value) => `${value}%`} />
        ) : null}
        <span className="flex-1" />
      </div>
      <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        {t(blend === "fade" ? "tools.compare.sideBySide.overlay.fadeHint" : "tools.compare.sideBySide.overlay.differenceHint")}
        {row && row.a === null ? ` · ${t("tools.compare.onlyB")}` : ""}
        {row && row.b === null ? ` · ${t("tools.compare.onlyA")}` : ""}
      </p>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6">
        {current?.error ? (
          <ErrorState title={t("tools.failed")} message={current.error} onRetry={() => setAttempt((value) => value + 1)} />
        ) : images ? (
          <div className="relative mx-auto w-full max-w-4xl shadow-md" style={{ aspectRatio: `${images.width} / ${images.height}` }}>
            <img src={`data:image/png;base64,${images.imageA}`} alt={sourceA.fileName} className="absolute inset-0 size-full" />
            <img
              src={`data:image/png;base64,${images.imageB}`}
              alt={sourceB.fileName}
              className="absolute inset-0 size-full"
              style={blend === "fade" ? { opacity: opacity / 100 } : { mixBlendMode: "difference" }}
            />
          </div>
        ) : (
          <div aria-busy role="status" className="mx-auto aspect-[3/4] w-full max-w-4xl animate-pulse rounded-md bg-muted">
            <span className="sr-only">{t("tools.compare.sideBySide.overlay.loading")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
