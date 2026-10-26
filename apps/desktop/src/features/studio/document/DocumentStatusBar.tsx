import type { RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { steppedZoom, useDocumentViewStore, ZOOM_STEPS, zoomPercent, type DocumentZoom } from "./documentView";
import { currentPage, type PageLine } from "./pageBreaks";
import type { DocumentLayout } from "./useDocumentLayout";
import { WordCount } from "./WordCount";

const FITS = ["width", "page"] as const;

type StatusBarProps = { editor: Editor; language: string; layout: DocumentLayout; zoom: number; lines: PageLine[] | null; paper: RefObject<HTMLDivElement | null> };

function PageCount({ editor, layout, zoom, lines, paper }: Omit<StatusBarProps, "language">) {
  const { t } = useTranslation();
  const head = useEditorState({ editor, selector: ({ editor: current }) => current.state.selection.head });
  const pages = layout.preview?.pageCount;
  if (pages === undefined) return <span data-testid="document-page-count">{t("studio.doc.status.counting")}</span>;
  const page = lines && head >= 0 ? currentPage(editor, layout.preview, lines, paper.current, zoom) : null;
  return (
    <span className="tabular-nums text-foreground" data-testid="document-page-count">
      {page === null ? t("studio.doc.status.pages", { count: pages }) : t("studio.doc.status.page", { page, count: pages })}
    </span>
  );
}

export function DocumentStatusBar({ editor, language, layout, zoom, lines, paper }: StatusBarProps) {
  const { t } = useTranslation();
  const mode = useDocumentViewStore((state) => state.zoom);
  const setZoom = useDocumentViewStore((state) => state.setZoom);
  const percent = zoomPercent(zoom);
  const nearest = ZOOM_STEPS.reduce((best, step) => (Math.abs(step - percent) < Math.abs(best - percent) ? step : best), ZOOM_STEPS[0]);
  const options = [
    ...FITS.map((fit) => ({ value: fit, label: fit === mode ? t("studio.doc.zoom.fitShown", { name: t(`studio.doc.zoom.${fit}`), percent }) : t(`studio.doc.zoom.${fit}`) })),
    ...ZOOM_STEPS.map((step) => ({ value: String(step), label: t("studio.doc.zoom.percent", { percent: step }) })),
  ];

  return (
    <footer aria-label={t("studio.doc.status.label")} className="glass flex h-8 shrink-0 items-center gap-4 border-t border-border/60 px-3 text-xs text-muted-foreground" data-testid="document-status">
      <PageCount editor={editor} layout={layout} zoom={zoom} lines={lines} paper={paper} />
      <WordCount editor={editor} language={language} />
      <span className="ms-auto flex items-center gap-1">
        <IconButton icon={Minus} label={t("studio.doc.zoom.out")} disabled={percent <= ZOOM_STEPS[0]} onClick={() => setZoom(steppedZoom(zoom, -1))} />
        <input
          type="range"
          min={0}
          max={ZOOM_STEPS.length - 1}
          step={1}
          value={ZOOM_STEPS.indexOf(nearest)}
          onChange={(event) => setZoom(ZOOM_STEPS[Number(event.target.value)])}
          aria-label={t("studio.doc.zoom.label")}
          aria-valuetext={t("studio.doc.zoom.percent", { percent })}
          className="w-28 accent-primary"
          data-testid="document-zoom-slider"
        />
        <IconButton icon={Plus} label={t("studio.doc.zoom.in")} disabled={percent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoom(steppedZoom(zoom, 1))} />
        <Select
          size="sm"
          className="h-7 w-44"
          value={typeof mode === "number" ? String(mode) : mode}
          options={options}
          onChange={(value) => setZoom((value === "width" || value === "page" ? value : Number(value)) as DocumentZoom)}
          ariaLabel={t("studio.doc.zoom.label")}
        />
      </span>
    </footer>
  );
}
