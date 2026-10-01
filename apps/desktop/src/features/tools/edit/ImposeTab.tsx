import { useTranslation } from "react-i18next";
import { Field, Fieldset, Section, SelectInput, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { ImposeLayoutPicker } from "@/features/tools/edit/ImposeLayoutPicker";
import { ImposeOrderPreview } from "@/features/tools/edit/ImposeOrderPreview";
import { IMPOSE_GAP_MM, IMPOSE_GRID, IMPOSE_GUTTER_MM, IMPOSE_MARGIN_MM, gridOf, hasSpine } from "@/features/tools/edit/imposeOrder";
import { wholeWithin, withinRange } from "@/shared/lib/numberRange";
import { useUiStore } from "@/shared/store/uiStore";
import type { ImposeArrangement, ImposeBinding, ImposeDuplex, ImposeLayout, ImposeReading, ImposeScale } from "@/types";

const PAPERS = ["auto", "a4", "a3", "letter", "tabloid"] as const;
const ORIENTATIONS = ["auto", "portrait", "landscape"] as const;
const ARRANGEMENTS: ImposeArrangement[] = ["rows", "columns"];
const READINGS: ImposeReading[] = ["ltr", "rtl"];
const BINDINGS: ImposeBinding[] = ["left", "right"];
const DUPLEXES: ImposeDuplex[] = ["both", "front", "back"];
const SCALES: ImposeScale[] = ["fit", "original"];

export type ImposeSettings = {
  layout: ImposeLayout;
  columns: number;
  rows: number;
  paper: (typeof PAPERS)[number];
  orientation: (typeof ORIENTATIONS)[number];
  margin: number;
  gap: number;
  gutter: number;
  arrangement: ImposeArrangement;
  reading: ImposeReading;
  binding: ImposeBinding;
  duplex: ImposeDuplex;
  flipShortEdge: boolean;
  creep: number;
  scale: ImposeScale;
  autoRotate: boolean;
  border: boolean;
  guides: boolean;
  pages: string;
};

export function ImposeTab({ settings, onChange }: { settings: ImposeSettings; onChange: (patch: Partial<ImposeSettings>) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const booklet = settings.layout === "booklet";
  const [columns, rows] = gridOf(settings.layout, settings.columns, settings.rows);

  return (
    <Section title={t("tools.edit.impose.title")}>
      <ImposeLayoutPicker
        label={t("tools.edit.impose.layout")}
        value={settings.layout}
        columns={settings.columns}
        rows={settings.rows}
        onChange={(layout) => onChange({ layout })}
      />
      {settings.layout === "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tools.edit.impose.columns")}>
            <TextInput type="number" min={IMPOSE_GRID.min} max={IMPOSE_GRID.max} value={settings.columns} aria-invalid={!wholeWithin(settings.columns, IMPOSE_GRID) || undefined} onChange={(event) => onChange({ columns: Number(event.target.value) })} className="font-mono" />
          </Field>
          <Field label={t("tools.edit.impose.rows")}>
            <TextInput type="number" min={IMPOSE_GRID.min} max={IMPOSE_GRID.max} value={settings.rows} aria-invalid={!wholeWithin(settings.rows, IMPOSE_GRID) || undefined} onChange={(event) => onChange({ rows: Number(event.target.value) })} className="font-mono" />
          </Field>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("tools.pages.paperSize")}>
          <SelectInput value={settings.paper} aria-label={t("tools.pages.paperSize")} onChange={(event) => onChange({ paper: event.target.value as (typeof PAPERS)[number] })}>
            {PAPERS.map((value) => (
              <option key={value} value={value}>{t(`tools.edit.impose.papers.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.edit.impose.orientation")}>
          <SelectInput value={settings.orientation} aria-label={t("tools.edit.impose.orientation")} onChange={(event) => onChange({ orientation: event.target.value as (typeof ORIENTATIONS)[number] })}>
            {ORIENTATIONS.map((value) => (
              <option key={value} value={value}>{t(`tools.edit.impose.orientations.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("tools.edit.impose.margin")}>
          <TextInput type="number" min={IMPOSE_MARGIN_MM.min} max={IMPOSE_MARGIN_MM.max} step={0.5} value={settings.margin} aria-invalid={!withinRange(settings.margin, IMPOSE_MARGIN_MM) || undefined} onChange={(event) => onChange({ margin: Number(event.target.value) })} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.impose.gap")}>
          <TextInput type="number" min={IMPOSE_GAP_MM.min} max={IMPOSE_GAP_MM.max} step={0.5} value={settings.gap} aria-invalid={!withinRange(settings.gap, IMPOSE_GAP_MM) || undefined} onChange={(event) => onChange({ gap: Number(event.target.value) })} className="font-mono" />
        </Field>
        {hasSpine(columns) ? (
          <Field label={t("tools.edit.impose.gutter")} hint={t("tools.edit.impose.gutterHint")}>
            <TextInput type="number" min={IMPOSE_GUTTER_MM.min} max={IMPOSE_GUTTER_MM.max} step={0.5} value={settings.gutter} aria-invalid={!withinRange(settings.gutter, IMPOSE_GUTTER_MM) || undefined} onChange={(event) => onChange({ gutter: Number(event.target.value) })} className="font-mono" />
          </Field>
        ) : null}
      </div>
      {booklet ? null : (
        <Fieldset title={t("tools.edit.impose.order")}>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <Field label={t("tools.edit.impose.arrangement")}>
                <SelectInput value={settings.arrangement} aria-label={t("tools.edit.impose.arrangement")} onChange={(event) => onChange({ arrangement: event.target.value as ImposeArrangement })}>
                  {ARRANGEMENTS.map((value) => (
                    <option key={value} value={value}>{t(`tools.edit.impose.arrangements.${value}`)}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={t("tools.edit.impose.reading")} hint={t("tools.edit.impose.readingHint")}>
                <SelectInput value={settings.reading} aria-label={t("tools.edit.impose.reading")} onChange={(event) => onChange({ reading: event.target.value as ImposeReading })}>
                  {READINGS.map((value) => (
                    <option key={value} value={value}>{t(`tools.edit.impose.readings.${value}`)}</option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <ImposeOrderPreview columns={columns} rows={rows} arrangement={settings.arrangement} reading={settings.reading} label={t("tools.edit.impose.order")} />
          </div>
        </Fieldset>
      )}
      {booklet ? (
        <Fieldset title={t("tools.edit.impose.printing")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("tools.edit.impose.binding")}>
              <SelectInput value={settings.binding} aria-label={t("tools.edit.impose.binding")} onChange={(event) => onChange({ binding: event.target.value as ImposeBinding })}>
                {BINDINGS.map((value) => (
                  <option key={value} value={value}>{t(`tools.edit.impose.bindings.${value}`)}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t("tools.edit.impose.duplex")} hint={t("tools.edit.impose.duplexHint")}>
              <SelectInput value={settings.duplex} aria-label={t("tools.edit.impose.duplex")} onChange={(event) => onChange({ duplex: event.target.value as ImposeDuplex })}>
                {DUPLEXES.map((value) => (
                  <option key={value} value={value}>{t(`tools.edit.impose.duplexes.${value}`)}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <SwitchField label={t("tools.edit.impose.flipShortEdge")} hint={t("tools.edit.impose.flipShortEdgeHint")} checked={settings.flipShortEdge} onChange={(flipShortEdge) => onChange({ flipShortEdge })} />
          <SliderField label={t("tools.edit.impose.creep")} hint={t("tools.edit.impose.creepHint")} value={settings.creep} min={0} max={5} step={0.1} onChange={(creep) => onChange({ creep })} format={(value) => t("tools.edit.impose.creepValue", { value: value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })} />
        </Fieldset>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.edit.impose.scale")}>
          <SelectInput value={settings.scale} aria-label={t("tools.edit.impose.scale")} onChange={(event) => onChange({ scale: event.target.value as ImposeScale })}>
            {SCALES.map((value) => (
              <option key={value} value={value}>{t(`tools.edit.impose.scales.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={settings.pages} onChange={(event) => onChange({ pages: event.target.value })} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
      </div>
      <SwitchField label={t("tools.edit.impose.autoRotate")} hint={t("tools.edit.impose.autoRotateHint")} checked={settings.autoRotate} onChange={(autoRotate) => onChange({ autoRotate })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchField label={t("tools.edit.impose.border")} checked={settings.border} onChange={(border) => onChange({ border })} />
        <SwitchField label={t("tools.edit.impose.guides")} hint={t("tools.edit.impose.guidesHint")} checked={settings.guides} onChange={(guides) => onChange({ guides })} />
      </div>
    </Section>
  );
}
