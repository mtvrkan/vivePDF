import { useTranslation } from "react-i18next";
import { FontPicker } from "@/components/shared/FontPicker";
import { Select } from "@/components/shared/Select";
import { Checkbox, Field, Segmented, TextInput } from "@/components/tool/form";
import type { DocumentSettings } from "@/types/studio";
import { ColorField, NumberField, PanelSection } from "../design/controls";
import { loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { COVER_STYLES, DOCUMENT_ALIGNS, DOCUMENT_PAPERS, PAGE_NUMBER_PLACES } from "./model";

const ORIENTATIONS = ["portrait", "landscape"] as const;
const DEPTHS = [1, 2, 3] as const;

export function DocumentSettingsPanel() {
  const { t } = useTranslation();
  const settings = useDocumentStore((state) => state.document?.settings);
  const setSettings = useDocumentStore((state) => state.setSettings);
  if (!settings) return null;
  const update = (patch: Partial<DocumentSettings>) => setSettings(patch);
  const text = (key: keyof DocumentSettings, limit: number) => ({
    value: String(settings[key] ?? ""),
    maxLength: limit,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update({ [key]: event.target.value }),
  });

  return (
    <div data-testid="document-settings">
      <PanelSection title={t("studio.doc.settings.page")}>
        <Field label={t("studio.doc.settings.paper")}>
          <Select size="sm" value={settings.paper} options={DOCUMENT_PAPERS.map((paper) => ({ value: paper, label: t(`studio.doc.papers.${paper}`) }))} onChange={(paper) => update({ paper: paper as DocumentSettings["paper"] })} ariaLabel={t("studio.doc.settings.paper")} />
        </Field>
        <Segmented size="sm" value={settings.landscape ? "landscape" : "portrait"} options={ORIENTATIONS} labelOf={(value) => t(`studio.doc.settings.${value}`)} onChange={(value) => update({ landscape: value === "landscape" })} ariaLabel={t("studio.doc.settings.orientation")} className="w-full" />
        <NumberField label={t("studio.doc.settings.margin")} suffix="mm" value={settings.marginMm} min={5} max={50} onChange={(marginMm) => update({ marginMm })} />
      </PanelSection>
      <PanelSection title={t("studio.doc.settings.text")}>
        <Field label={t("studio.doc.settings.font")}>
          <FontPicker
            value={settings.fontId}
            onChange={(fontId) => {
              void loadDocumentFont(fontId);
              update({ fontId });
            }}
          />
        </Field>
        <Checkbox label={t("studio.doc.settings.headingSame")} checked={settings.headingFontId === null} onChange={(same) => update({ headingFontId: same ? null : settings.fontId })} />
        {settings.headingFontId !== null ? (
          <Field label={t("studio.doc.settings.headingFont")}>
            <FontPicker
              value={settings.headingFontId}
              onChange={(headingFontId) => {
                void loadDocumentFont(headingFontId);
                update({ headingFontId });
              }}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t("studio.doc.settings.fontSize")} suffix="pt" value={settings.fontSize} min={6} max={28} step={0.5} onChange={(fontSize) => update({ fontSize })} />
          <NumberField label={t("studio.doc.settings.lineHeight")} value={settings.lineHeight} min={1} max={3} step={0.1} onChange={(lineHeight) => update({ lineHeight })} />
        </div>
        <ColorField label={t("studio.doc.settings.accent")} value={settings.accent} onChange={(accent) => update({ accent })} />
      </PanelSection>
      <PanelSection title={t("studio.doc.settings.furniture")}>
        <Field label={t("studio.doc.settings.header")}>
          <TextInput {...text("header", 200)} />
        </Field>
        <Segmented size="sm" value={settings.headerAlign} options={DOCUMENT_ALIGNS} labelOf={(value) => t(`studio.textAlign.${value}`)} onChange={(headerAlign) => update({ headerAlign })} ariaLabel={t("studio.doc.settings.headerAlign")} className="w-full" />
        <Field label={t("studio.doc.settings.footer")}>
          <TextInput {...text("footer", 200)} />
        </Field>
        <Segmented size="sm" value={settings.footerAlign} options={DOCUMENT_ALIGNS} labelOf={(value) => t(`studio.textAlign.${value}`)} onChange={(footerAlign) => update({ footerAlign })} ariaLabel={t("studio.doc.settings.footerAlign")} className="w-full" />
        <Field label={t("studio.doc.settings.pageNumbers")}>
          <Select size="sm" value={settings.pageNumbers} options={PAGE_NUMBER_PLACES.map((place) => ({ value: place, label: t(`studio.doc.numbers.${place}`) }))} onChange={(place) => update({ pageNumbers: place as DocumentSettings["pageNumbers"] })} ariaLabel={t("studio.doc.settings.pageNumbers")} />
        </Field>
        {settings.pageNumbers !== "none" ? (
          <Field label={t("studio.doc.settings.numberFormat")} hint={t("studio.doc.settings.numberFormatHint")}>
            <TextInput {...text("pageNumberFormat", 40)} className="font-mono text-sm" />
          </Field>
        ) : null}
        <Checkbox label={t("studio.doc.settings.furnitureOnFirst")} checked={settings.furnitureOnFirst} onChange={(furnitureOnFirst) => update({ furnitureOnFirst })} />
      </PanelSection>
      <PanelSection title={t("studio.doc.settings.contents")}>
        <Checkbox label={t("studio.doc.settings.toc")} hint={t("studio.doc.settings.tocHint")} checked={settings.toc} onChange={(toc) => update({ toc })} />
        {settings.toc ? (
          <>
            <Field label={t("studio.doc.settings.tocTitle")}>
              <TextInput {...text("tocTitle", 100)} placeholder={t("studio.doc.settings.tocTitleDefault")} />
            </Field>
            <Segmented size="sm" value={settings.tocDepth} options={DEPTHS} labelOf={(value) => t("studio.doc.settings.depth", { count: value })} onChange={(tocDepth) => update({ tocDepth })} ariaLabel={t("studio.doc.settings.tocDepth")} className="w-full" />
          </>
        ) : null}
      </PanelSection>
      <PanelSection title={t("studio.doc.settings.coverSection")}>
        <Checkbox label={t("studio.doc.settings.cover")} checked={settings.cover} onChange={(cover) => update({ cover })} />
        {settings.cover ? (
          <>
            <Field label={t("studio.doc.settings.coverStyle")}>
              <Select size="sm" value={settings.coverStyle} options={COVER_STYLES.map((style) => ({ value: style, label: t(`studio.doc.covers.${style}`) }))} onChange={(style) => update({ coverStyle: style as DocumentSettings["coverStyle"] })} ariaLabel={t("studio.doc.settings.coverStyle")} />
            </Field>
            <Field label={t("studio.doc.settings.title")}>
              <TextInput {...text("title", 300)} />
            </Field>
            <Field label={t("studio.doc.settings.subtitle")}>
              <TextInput {...text("subtitle", 300)} />
            </Field>
            <Field label={t("studio.doc.settings.author")}>
              <TextInput {...text("author", 300)} />
            </Field>
            <Field label={t("studio.doc.settings.date")}>
              <TextInput {...text("date", 80)} />
            </Field>
          </>
        ) : null}
      </PanelSection>
    </div>
  );
}
