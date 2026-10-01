import { useEffect, useMemo, useRef, useState } from "react";
import { AArrowDown, AArrowUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { getPageText } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { READING_FONT_MAX, READING_FONT_MIN, useReadingStore, type ActiveSentence } from "@/shared/store/readingStore";
import type { PageText, ReadingTheme, ReadingWidth } from "@/types";
import { overlapsRange, placeholderHeight, readingParagraphs, type MeasuredHeight, type ReadingPiece } from "./readingLayout";

const THEMES: ReadingTheme[] = ["paper", "sepia", "dark"];
const WIDTHS: ReadingWidth[] = ["narrow", "medium", "wide"];
const THEME_CLASS: Record<ReadingTheme, string> = {
  paper: "bg-white text-neutral-900",
  sepia: "bg-[#f4ecd8] text-[#3b2f1e]",
  dark: "bg-neutral-950 text-neutral-200",
};
const WIDTH_CLASS: Record<ReadingWidth, string> = { narrow: "max-w-[34rem]", medium: "max-w-[44rem]", wide: "max-w-[60rem]" };
const VIEWPORT_MARGIN_MULTIPLIER = 2;

function isActivePiece(piece: ReadingPiece, active: ActiveSentence | null, page: number): boolean {
  if (!active || active.page !== page) return false;
  if (active.start !== undefined && active.end !== undefined) return overlapsRange(piece, { start: active.start, end: active.end });
  return piece.sentenceIndex === active.index;
}

function PageSection({
  entry,
  fontSize,
  layoutKey,
  active,
  onExit,
  t,
}: {
  entry: PageText;
  fontSize: number;
  layoutKey: string;
  active: ActiveSentence | null;
  onExit: (page: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [measured, setMeasured] = useState<MeasuredHeight | null>(null);
  const paragraphs = useMemo(() => readingParagraphs(entry.text), [entry.text]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !visible || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) setMeasured((current) => (current && current.layoutKey === layoutKey && Math.abs(current.height - height) < 0.5 ? current : { layoutKey, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, layoutKey]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const margin = Math.round(window.innerHeight * VIEWPORT_MARGIN_MULTIPLIER);
    const observer = new IntersectionObserver(([observed]) => setVisible(observed.isIntersecting), {
      rootMargin: `${margin}px 0px`,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} data-page={entry.page} className="mb-10" style={!visible ? { minHeight: placeholderHeight(measured, layoutKey, entry.text, fontSize) } : undefined}>
      <button type="button" onClick={() => onExit(entry.page)} className="mb-3 flex min-h-6 items-center text-[11px] font-semibold uppercase tracking-[0.08em] opacity-75 hover:opacity-100">
        {t("viewer.reading.page", { page: entry.page })}
      </button>
      {!visible ? null : entry.text ? (
        paragraphs.map((paragraph, index) => (
          <p key={index} className="mb-4 whitespace-pre-wrap">
            {paragraph.pieces.map((piece, pieceIndex) => (
              <span key={pieceIndex} data-sentence-index={piece.sentenceIndex} data-active={isActivePiece(piece, active, entry.page) ? "true" : undefined} className={cn(isActivePiece(piece, active, entry.page) && "rounded bg-primary/25 text-foreground")}>
                {piece.text}
              </span>
            ))}
          </p>
        ))
      ) : (
        <p className="mb-4 italic opacity-60">{t("viewer.reading.noText")}</p>
      )}
    </section>
  );
}

export function ReadingView({ documentId, onExit }: { documentId: string; onExit: () => void }) {
  const { t } = useTranslation();
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const fontSize = useReadingStore((state) => state.fontSize);
  const width = useReadingStore((state) => state.width);
  const theme = useReadingStore((state) => state.theme);
  const update = useReadingStore((state) => state.update);
  const activeSentence = useReadingStore((state) => state.activeSentence);
  const scrollRequest = useReadingStore((state) => state.scrollRequest);
  const clearPageScrollRequest = useReadingStore((state) => state.clearPageScrollRequest);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialPage = useRef(scroll?.getCurrentPage() ?? scrollState.currentPage);
  const [attempt, setAttempt] = useState(0);
  const path = document?.path ?? null;
  const password = document?.password ?? undefined;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setPages(null);
    setError(null);
    getPageText({ path, password })
      .then((result) => {
        if (!cancelled) setPages(result.pages);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(t, toRpcError(caught)));
      });
    return () => {
      cancelled = true;
    };
  }, [path, password, attempt, t]);

  useEffect(() => {
    if (!pages || !containerRef.current) return;
    const target = containerRef.current.querySelector<HTMLElement>(`[data-page="${initialPage.current}"]`);
    target?.scrollIntoView({ block: "start" });
  }, [pages]);

  useEffect(() => {
    if (scrollRequest === null || !containerRef.current) return;
    const target = containerRef.current.querySelector<HTMLElement>(`[data-page="${scrollRequest}"]`);
    target?.scrollIntoView({ block: "start" });
    clearPageScrollRequest();
  }, [scrollRequest, clearPageScrollRequest]);

  useEffect(() => {
    if (!activeSentence || !containerRef.current) return;
    const target =
      containerRef.current.querySelector<HTMLElement>(`[data-page="${activeSentence.page}"] [data-active="true"]`) ??
      containerRef.current.querySelector<HTMLElement>(`[data-page="${activeSentence.page}"] [data-sentence-index="${activeSentence.index}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSentence]);

  const exitTo = (page: number) => {
    scroll?.scrollToPage({ pageNumber: page });
    onExit();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="glass-flat flex h-11 items-center gap-2 border-b px-3 text-sm">
        <span className="font-medium">{t("viewer.reading.title")}</span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <IconButton icon={AArrowDown} label={t("viewer.reading.smaller")} disabled={fontSize <= READING_FONT_MIN} onClick={() => update({ fontSize: Math.max(READING_FONT_MIN, fontSize - 1) })} />
        <span className="w-8 text-center font-mono text-xs tabular-nums text-muted-foreground">{fontSize}</span>
        <IconButton icon={AArrowUp} label={t("viewer.reading.larger")} disabled={fontSize >= READING_FONT_MAX} onClick={() => update({ fontSize: Math.min(READING_FONT_MAX, fontSize + 1) })} />
        <Select value={width} options={WIDTHS.map((value) => ({ value, label: t(`viewer.reading.widths.${value}`) }))} onChange={(value) => update({ width: value as ReadingWidth })} ariaLabel={t("viewer.reading.width")} className="w-32" />
        <Select value={theme} options={THEMES.map((value) => ({ value, label: t(`viewer.reading.themes.${value}`) }))} onChange={(value) => update({ theme: value as ReadingTheme })} ariaLabel={t("viewer.reading.theme")} className="w-32" />
        <span className="flex-1" />
        <IconButton icon={X} label={t("viewer.reading.exit")} onClick={onExit} />
      </div>
      <div ref={containerRef} className={cn("min-h-0 flex-1 overflow-auto", THEME_CLASS[theme])}>
        {!pages && !error ? (
          <div className="mx-auto max-w-[44rem] p-8">
            <SkeletonCard lines={10} />
          </div>
        ) : null}
        {error ? <ErrorState title={t("viewer.reading.loadFailed")} message={error} onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {pages ? (
          <article className={cn("mx-auto px-8 py-10", WIDTH_CLASS[width])} style={{ fontSize: `${fontSize}px`, lineHeight: 1.65 }}>
            {pages.map((entry) => (
              <PageSection
                key={entry.page}
                entry={entry}
                fontSize={fontSize}
                layoutKey={`${fontSize}|${width}`}
                active={activeSentence}
                onExit={exitTo}
                t={t}
              />
            ))}
          </article>
        ) : null}
      </div>
    </div>
  );
}
