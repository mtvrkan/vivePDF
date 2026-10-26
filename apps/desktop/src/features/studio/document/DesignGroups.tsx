import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { Select } from "@/components/shared/Select";
import type { DocumentSettings } from "@/types/studio";
import { RibbonGroup, RibbonRow, RibbonRows } from "../ribbon/Ribbon";
import { loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";

const BODY_SIZES = [9, 10, 10.5, 11, 11.5, 12, 13, 14, 16];
const LINE_HEIGHTS = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const ACCENTS = ["#1f4e79", "#1e3a8a", "#0f766e", "#7a2e3a", "#6b4c9a", "#b45309", "#1a1a1a"];

function withCurrent(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((left, right) => left - right);
}

function FontRow({ label, value, onChange }: { label: string; value: string; onChange: (fontId: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-16 truncate text-xs text-muted-foreground">{label}</span>
      <div className="w-44">
        <FontPicker compact value={value} onChange={onChange} />
      </div>
    </div>
  );
}

export function DesignGroups({ settings }: { settings: DocumentSettings }) {
  const { t, i18n } = useTranslation();
  const update = (patch: Partial<DocumentSettings>) => useDocumentStore.getState().setSettings(patch);
  const number = (value: number) => value.toLocaleString(i18n.language);
  const setBody = (fontId: string) => {
    void loadDocumentFont(fontId);
    update(settings.headingFontId === fontId ? { fontId, headingFontId: null } : { fontId });
  };
  const setHeading = (fontId: string) => {
    void loadDocumentFont(fontId);
    update({ headingFontId: fontId === settings.fontId ? null : fontId });
  };

  return (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.fonts")}>
        <RibbonRows>
          <FontRow label={t("studio.doc.ribbon.bodyFont")} value={settings.fontId} onChange={setBody} />
          <FontRow label={t("studio.doc.ribbon.headingFont")} value={settings.headingFontId ?? settings.fontId} onChange={setHeading} />
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.text")}>
        <RibbonRows>
          <RibbonRow>
            <span className="w-24 truncate text-xs text-muted-foreground">{t("studio.doc.ribbon.bodySize")}</span>
            <Select
              size="sm"
              className="h-8 w-24"
              value={String(settings.fontSize)}
              options={withCurrent(BODY_SIZES, settings.fontSize).map((size) => ({ value: String(size), label: `${number(size)} pt` }))}
              onChange={(value) => update({ fontSize: Number(value) })}
              ariaLabel={t("studio.doc.ribbon.bodySize")}
            />
          </RibbonRow>
          <RibbonRow>
            <span className="w-24 truncate text-xs text-muted-foreground">{t("studio.doc.settings.lineHeight")}</span>
            <Select
              size="sm"
              className="h-8 w-24"
              value={String(settings.lineHeight)}
              options={withCurrent(LINE_HEIGHTS, settings.lineHeight).map((height) => ({ value: String(height), label: number(height) }))}
              onChange={(value) => update({ lineHeight: Number(value) })}
              ariaLabel={t("studio.doc.settings.lineHeight")}
            />
          </RibbonRow>
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.colour")}>
        <div className="flex flex-col items-center gap-1" data-testid="doc-accent">
          <ColorSwatch icon={Palette} value={settings.accent} presets={ACCENTS} onChange={(accent) => update({ accent })} label={t("studio.doc.settings.accent")} customLabel={t("colorPicker.custom")} />
          <span className="text-xs text-muted-foreground">{t("studio.doc.settings.accent")}</span>
        </div>
      </RibbonGroup>
    </>
  );
}
