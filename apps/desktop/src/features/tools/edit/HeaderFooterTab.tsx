import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { Checkbox, Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { PageSlots } from "@/components/tool/PageSlots";
import { DATE_FORMATS } from "@/shared/lib/dateFormats";
import { FURNITURE_MARGIN_MM, HEADER_FONT_SIZE } from "./editShared";
import type { HeaderFooterState, StampState } from "./editFormState";

export function HeaderFooterTab({ state, stamp, pages, onPagesChange: setPages, running }: { state: HeaderFooterState; stamp: StampState; pages: string; onPagesChange: (value: string) => void; running: boolean }) {
  const { t } = useTranslation();
  const { headerFontSize, setHeaderFontSize, header, setHeader, footer, setFooter, headerMode, setHeaderMode, headerStart, setHeaderStart, headerDateFormat, setHeaderDateFormat, headerReplace, setHeaderReplace, removeScope, setRemoveScope, headerFontValid } = state;
  const { marginMm, setMarginMm, color, setColor, bold, setBold, fontId, setFontId, marginValid } = stamp;
  return (
    <Section title={t("tools.edit.headerFooter.title")}>
      <OptionCards
        value={headerMode}
        onChange={setHeaderMode}
        ariaLabel={t("tools.edit.headerFooter.mode")}
        options={[
          { value: "add", title: t("tools.edit.headerFooter.modes.add"), description: t("tools.edit.headerFooter.modeHints.add") },
          { value: "remove", title: t("tools.edit.headerFooter.modes.remove"), description: t("tools.edit.headerFooter.modeHints.remove") },
        ]}
      />
      {headerMode === "remove" ? (
        <>
          <OptionCards
            value={removeScope}
            onChange={setRemoveScope}
            ariaLabel={t("tools.edit.headerFooter.scope")}
            options={[
              { value: "vivepdf", title: t("tools.edit.headerFooter.scopes.vivepdf"), description: t("tools.edit.headerFooter.scopeHints.vivepdf") },
              { value: "all", title: t("tools.edit.headerFooter.scopes.all"), description: t("tools.edit.headerFooter.scopeHints.all") },
            ]}
          />
          <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
            <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="w-64 font-mono" />
          </Field>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("tools.edit.headerFooter.hint")}</p>
          <PageSlots
            header={header}
            footer={footer}
            onHeader={(side, value) => setHeader((state) => ({ ...state, [side]: value }))}
            onFooter={(side, value) => setFooter((state) => ({ ...state, [side]: value }))}
            headerLabel={t("tools.edit.headerFooter.header")}
            footerLabel={t("tools.edit.headerFooter.footer")}
            sideLabel={(side) => t(`tools.edit.headerFooter.${side}`)}
            disabled={running}
          />
          <Field label={t("fontPicker.label")} hint={t("fontPicker.hint")}>
            <FontPicker value={fontId} onChange={setFontId} disabled={running} />
          </Field>
          <div className="grid grid-cols-4 gap-3">
            <Field label={t("tools.fontSize")} hint={headerFontValid ? undefined : t("tools.outOfRange", HEADER_FONT_SIZE)}>
              <TextInput type="number" min={HEADER_FONT_SIZE.min} max={HEADER_FONT_SIZE.max} value={headerFontSize} onChange={(event) => setHeaderFontSize(event.target.valueAsNumber)} aria-invalid={!headerFontValid || undefined} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.marginMm")} hint={marginValid ? undefined : t("tools.outOfRange", FURNITURE_MARGIN_MM)}>
              <TextInput type="number" min={FURNITURE_MARGIN_MM.min} max={FURNITURE_MARGIN_MM.max} value={marginMm} onChange={(event) => setMarginMm(event.target.valueAsNumber)} aria-invalid={!marginValid || undefined} className="font-mono" />
            </Field>
            <Field label={t("tools.pageRange")}>
              <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
            </Field>
            <div className="flex items-end pb-1">
              <Checkbox label={t("tools.bold")} checked={bold} onChange={setBold} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("tools.edit.headerFooter.start")} hint={t("tools.edit.headerFooter.startHint")}>
              <TextInput type="number" min={0} value={headerStart} onChange={(event) => setHeaderStart(Math.max(0, Number(event.target.value) || 0))} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.headerFooter.dateFormat")}>
              <SelectInput value={headerDateFormat} aria-label={t("tools.edit.headerFooter.dateFormat")} onChange={(event) => setHeaderDateFormat(event.target.value)}>
                {DATE_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>{format.label}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t("tools.color")}>
              <ColorSwatch value={color} onChange={setColor} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
            </Field>
          </div>
          <SwitchField label={t("tools.edit.headerFooter.replaceExisting")} hint={t("tools.edit.headerFooter.replaceExistingHint")} checked={headerReplace} onChange={setHeaderReplace} />
        </>
      )}
    </Section>
  );
}
