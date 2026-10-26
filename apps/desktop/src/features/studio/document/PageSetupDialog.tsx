import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Select } from "@/components/shared/Select";
import { Field, Segmented } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { DocumentSettings } from "@/types/studio";
import { NumberField } from "../design/controls";
import { useDocumentStore } from "./documentStore";
import { contentInsets, DOCUMENT_COLUMNS, DOCUMENT_PAPERS, GUTTER_SIDES, MARGIN_LIMITS, MIN_TEXT_MM, pageSize, POINTS_PER_MM } from "./model";

const TABS = ["margins", "paper", "layout"] as const;
const ORIENTATIONS = ["portrait", "landscape"] as const;
const PREVIEW_SIDE = 132;

type PageSetupTab = (typeof TABS)[number];

function PagePreview({ settings }: { settings: DocumentSettings }) {
  const { t } = useTranslation();
  const size = pageSize(settings);
  const scale = PREVIEW_SIDE / Math.max(size.width, size.height);
  const inset = contentInsets(settings);
  const gutter = settings.gutterMm * POINTS_PER_MM * scale;
  const percent = (value: number, whole: number) => `${(value / whole) * 100}%`;
  return (
    <figure className="flex shrink-0 flex-col items-center gap-2" aria-label={t("studio.doc.pageSetup.preview")} data-testid="page-setup-preview">
      <div className="flex items-center justify-center" style={{ width: PREVIEW_SIDE, height: PREVIEW_SIDE }}>
        <div className="paper-surface relative border border-border bg-card shadow-sm" style={{ width: size.width * scale, height: size.height * scale }}>
          {gutter > 0 ? (
            <span
              className="absolute bg-muted-foreground/20"
              style={settings.gutterSide === "left" ? { left: 0, top: 0, bottom: 0, width: gutter } : { left: 0, right: 0, top: 0, height: gutter }}
              aria-hidden
            />
          ) : null}
          <span
            className="absolute border border-dashed border-primary/70"
            style={{ top: percent(inset.top, size.height), bottom: percent(inset.bottom, size.height), left: percent(inset.left, size.width), right: percent(inset.right, size.width) }}
            aria-hidden
          />
        </div>
      </div>
      <figcaption className="text-xs text-muted-foreground">{t(`studio.doc.papers.${settings.paper}`)}</figcaption>
    </figure>
  );
}

export function PageSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useDocumentStore((state) => state.document?.settings);
  const setSettings = useDocumentStore((state) => state.setSettings);
  const [tab, setTab] = useState<PageSetupTab>("margins");
  if (!settings) return null;
  const update = (patch: Partial<DocumentSettings>) => setSettings(patch);
  const size = pageSize(settings);
  const inset = contentInsets(settings);
  const tooSmall = Math.min(size.width - inset.left - inset.right, size.height - inset.top - inset.bottom) < MIN_TEXT_MM * POINTS_PER_MM;
  const margin = (key: "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm") => (
    <NumberField label={t(`studio.doc.pageSetup.${key}`)} suffix="mm" value={settings[key]} min={MARGIN_LIMITS.margin[0]} max={MARGIN_LIMITS.margin[1]} step={0.5} onChange={(value) => update({ [key]: value })} />
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={t("studio.doc.pageSetup.title")} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <div className="space-y-4" data-testid="page-setup">
        <div role="tablist" aria-label={t("studio.doc.pageSetup.title")} className="flex gap-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`page-setup-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="page-setup-panel"
              onClick={() => setTab(id)}
              data-testid={`page-setup-${id}`}
              className={cn("rounded-lg px-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === id ? "glass-chip text-primary" : "nav-glass text-foreground/80 hover:text-foreground")}
            >
              {t(`studio.doc.pageSetup.tabs.${id}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-5">
          <div role="tabpanel" id="page-setup-panel" aria-labelledby={`page-setup-tab-${tab}`} className="min-w-0 flex-1 space-y-3">
            {tab === "margins" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {margin("marginTopMm")}
                  {margin("marginBottomMm")}
                  {margin("marginLeftMm")}
                  {margin("marginRightMm")}
                </div>
                <div className="grid grid-cols-2 items-start gap-2">
                  <NumberField label={t("studio.doc.pageSetup.gutter")} suffix="mm" value={settings.gutterMm} min={MARGIN_LIMITS.gutter[0]} max={MARGIN_LIMITS.gutter[1]} step={0.5} onChange={(gutterMm) => update({ gutterMm })} />
                  <div className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground" aria-hidden>
                      {t("studio.doc.pageSetup.gutterSide")}
                    </span>
                    <Segmented size="sm" value={settings.gutterSide} options={GUTTER_SIDES} labelOf={(side) => t(`studio.doc.pageSetup.gutterSides.${side}`)} onChange={(gutterSide) => update({ gutterSide })} ariaLabel={t("studio.doc.pageSetup.gutterSide")} className="grid w-full grid-cols-2" />
                  </div>
                </div>
                <Field label={t("studio.doc.settings.orientation")}>
                  <Segmented size="sm" value={settings.landscape ? "landscape" : "portrait"} options={ORIENTATIONS} labelOf={(value) => t(`studio.doc.settings.${value}`)} onChange={(value) => update({ landscape: value === "landscape" })} ariaLabel={t("studio.doc.settings.orientation")} className="grid w-full grid-cols-2" />
                </Field>
                {tooSmall ? (
                  <p role="alert" className="text-sm text-destructive" data-testid="page-setup-too-small">
                    {t("studio.doc.pageSetup.tooSmall")}
                  </p>
                ) : null}
              </>
            ) : null}
            {tab === "paper" ? (
              <Field label={t("studio.doc.settings.paper")} hint={t("studio.doc.pageSetup.paperSize", { width: Math.round(size.width / POINTS_PER_MM), height: Math.round(size.height / POINTS_PER_MM) })}>
                <Select size="sm" value={settings.paper} options={DOCUMENT_PAPERS.map((paper) => ({ value: paper, label: t(`studio.doc.papers.${paper}`) }))} onChange={(paper) => update({ paper: paper as DocumentSettings["paper"] })} ariaLabel={t("studio.doc.settings.paper")} />
              </Field>
            ) : null}
            {tab === "layout" ? (
              <>
                <Field label={t("studio.doc.settings.columns")} hint={settings.columns > 1 ? t("studio.doc.settings.columnsHint") : undefined}>
                  <Segmented size="sm" value={settings.columns} options={DOCUMENT_COLUMNS} labelOf={String} onChange={(columns) => update({ columns })} ariaLabel={t("studio.doc.settings.columns")} className="grid w-full grid-cols-3" />
                </Field>
                {settings.columns > 1 ? <NumberField label={t("studio.doc.settings.columnGap")} suffix="mm" value={settings.columnGapMm} min={4} max={20} onChange={(columnGapMm) => update({ columnGapMm })} /> : null}
              </>
            ) : null}
          </div>
          <PagePreview settings={settings} />
        </div>
      </div>
    </Dialog>
  );
}
