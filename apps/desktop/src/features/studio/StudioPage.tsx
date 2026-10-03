import { useState } from "react";
import { Palette, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUiStore } from "@/shared/store/uiStore";
import type { StudioDesign } from "@/types/studio";
import { STUDIO_PAGE_SIZES, createDesign, type StudioPageSize } from "./model/design";
import { Canvas } from "./design/Canvas";
import { NumberField } from "./design/controls";
import { fromMm, toMm } from "./design/units";
import { ElementsPanel } from "./design/ElementsPanel";
import { PageView } from "./design/ElementView";
import { ExportDialog } from "./design/ExportDialog";
import { PagesStrip } from "./design/PagesStrip";
import { PropertiesPanel } from "./design/PropertiesPanel";
import { StudioToolbar } from "./design/StudioToolbar";
import { readDraft, useStudioStore } from "./design/studioStore";
import { useStudioShortcuts } from "./design/useStudioShortcuts";

const START_SIZES: StudioPageSize[] = ["a4", "a4Landscape", "a5", "letter", "square", "story", "presentation", "businessCard", "poster"];
const PREVIEW_BOX = 96;

function SizeCard({ size, onPick }: { size: StudioPageSize; onPick: () => void }) {
  const { t } = useTranslation();
  const { width, height } = STUDIO_PAGE_SIZES[size];
  const scale = PREVIEW_BOX / Math.max(width, height);
  return (
    <button type="button" onClick={onPick} data-size={size} className="card glass-tinted flex flex-col items-center gap-3 rounded-xl p-4 text-center hover:ring-2 hover:ring-primary/40">
      <span className="flex size-24 items-center justify-center" aria-hidden>
        <span className="rounded-sm border border-border bg-background shadow-sm" style={{ width: `${width * scale}px`, height: `${height * scale}px` }} />
      </span>
      <span className="text-sm font-medium">{t(`studio.sizes.${size}`)}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {toMm(width)} × {toMm(height)} mm
      </span>
    </button>
  );
}

function StudioStart({ onOpen }: { onOpen: (design: StudioDesign, filePath?: string | null) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [draft] = useState(readDraft);
  const [custom, setCustom] = useState({ width: 210, height: 297 });
  const create = (width: number, height: number) => onOpen(createDesign("", width, height));
  const firstPage = draft?.design.pages[0];
  const previewScale = firstPage ? PREVIEW_BOX / Math.max(firstPage.width, firstPage.height) : 1;

  return (
    <div className="min-h-full">
      <PageHeader title={t("studio.title")} description={t("studio.description")} icon={Palette} tone="toPdf" />
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:px-6">
        {draft && firstPage ? (
          <section className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4" aria-label={t("studio.start.continue")}>
            <span className="relative block shrink-0 overflow-hidden rounded-md border border-border" style={{ width: `${firstPage.width * previewScale}px`, height: `${firstPage.height * previewScale}px` }} aria-hidden>
              <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${previewScale})` }}>
                <PageView page={firstPage} language={locale} />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("studio.start.continue")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {draft.design.name || t("studio.untitled")} · {t("studio.start.pages", { count: draft.design.pages.length })}
              </p>
            </div>
            <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => onOpen(draft.design, draft.filePath)}>
              {t("studio.start.resume")}
            </Button>
          </section>
        ) : null}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("studio.start.blank")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {START_SIZES.map((size) => (
              <SizeCard key={size} size={size} onPick={() => create(STUDIO_PAGE_SIZES[size].width, STUDIO_PAGE_SIZES[size].height)} />
            ))}
          </div>
        </section>
        <section className="card glass-tinted flex flex-wrap items-end gap-3 rounded-xl p-4">
          <h2 className="w-full text-sm font-semibold">{t("studio.start.custom")}</h2>
          <div className="w-32">
            <NumberField label={t("studio.page.width")} suffix="mm" value={custom.width} min={6.4} max={5080} onChange={(width) => setCustom((current) => ({ ...current, width }))} />
          </div>
          <div className="w-32">
            <NumberField label={t("studio.page.height")} suffix="mm" value={custom.height} min={6.4} max={5080} onChange={(height) => setCustom((current) => ({ ...current, height }))} />
          </div>
          <Button onClick={() => create(fromMm(custom.width), fromMm(custom.height))}>{t("studio.start.create")}</Button>
        </section>
      </div>
    </div>
  );
}

function StudioEditor({ language }: { language: string }) {
  const [exporting, setExporting] = useState(false);
  const close = useStudioStore((state) => state.close);
  useStudioShortcuts(() => setExporting(true));
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-editor">
      <StudioToolbar onExport={() => setExporting(true)} onLeave={close} />
      <div className="flex min-h-0 flex-1">
        <ElementsPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <Canvas language={language} />
          <PagesStrip language={language} />
        </div>
        <PropertiesPanel />
      </div>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} language={language} />
    </div>
  );
}

export function StudioPage() {
  const design = useStudioStore((state) => state.design);
  const open = useStudioStore((state) => state.open);
  const locale = useUiStore((state) => state.locale);
  if (!design) return <StudioStart onOpen={open} />;
  return <StudioEditor language={locale} />;
}
