import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { FitPreview } from "@/components/tool/FitPreview";
import { cn } from "@/shared/lib/cn";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import type { ResizeMode } from "@/types";
import { RESIZE_MARGIN_MM, RESIZE_SIDE_MM } from "./editShared";
import type { ResizeState } from "./editFormState";
import { formatMm, PAPER_SIZE_OPTIONS, PAPER_SIZES_MM, paperChange, paperName, paperScale, QUICK_PAPER_SIZES, type PageSizePt, type PaperSize } from "./paperSizes";

const QUICK_COLUMNS = 3;

function QuickSizes({ value, sourceSize, autoRotate, disabled, onChange }: { value: string; sourceSize: PageSizePt | null; autoRotate: boolean; disabled: boolean; onChange: (size: PaperSize) => void }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const current = QUICK_PAPER_SIZES.indexOf(value as PaperSize);
  const roving = useRovingRadios(QUICK_PAPER_SIZES, Math.max(0, current), onChange, QUICK_COLUMNS);
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 });
  return (
    <div>
      <p id={titleId} className="mb-1.5 text-sm font-medium text-foreground/80">{t("tools.edit.resize.quick")}</p>
      <div role="radiogroup" aria-labelledby={titleId} aria-describedby={hintId} aria-disabled={disabled || undefined} className={cn("grid grid-cols-3 gap-2", disabled && "opacity-50")}>
        {QUICK_PAPER_SIZES.map((size, index) => {
          const selected = size === value;
          const mm = PAPER_SIZES_MM[size];
          const scale = sourceSize ? paperScale(sourceSize, size, autoRotate) : null;
          const change = scale === null ? null : paperChange(scale);
          return (
            <button
              key={size}
              ref={roving.refOf(index)}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={current < 0 ? (index === 0 ? 0 : -1) : roving.tabIndexOf(index)}
              disabled={disabled}
              onKeyDown={roving.onKeyDown}
              onClick={() => onChange(size)}
              className={cn(
                "rounded-xl px-3 py-2.5 text-start transition-[background-color,box-shadow] duration-(--transition-fast)",
                selected ? "option-selected" : "nav-glass shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-accent",
              )}
            >
              <span className={cn("block text-sm font-semibold", selected ? "text-(--tone)" : "text-foreground")}>{paperName(size)}</span>
              <span className="block font-mono text-xs text-muted-foreground">{t("tools.edit.resize.sizeMm", { width: formatMm(mm.width, i18n.language), height: formatMm(mm.height, i18n.language) })}</span>
              {change && scale !== null ? (
                <span className={cn("mt-1 block text-xs font-medium", change === "shrink" ? "text-warning" : change === "enlarge" ? "text-primary" : "text-muted-foreground")}>
                  {t(`tools.edit.resize.change.${change}`, { percent: percent.format(scale) })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">{t(sourceSize ? "tools.edit.resize.quickHint" : "tools.edit.resize.quickHintNoSource")}</p>
    </div>
  );
}

export function ResizeTab({ state, pages, onPagesChange: setPages, sourceSize }: { state: ResizeState; pages: string; onPagesChange: (value: string) => void; sourceSize: PageSizePt | null }) {
  const { t } = useTranslation();
  const { preset, setPreset, customSize, setCustomSize, autoRotate, setAutoRotate, resizeMode, setResizeMode, resizeMargin, setResizeMargin, resizeMatchLargest, setResizeMatchLargest, resizeWidthValid, resizeHeightValid, resizeMarginValid } = state;
  return (
    <Section title={t("tools.edit.resize.title")}>
      <QuickSizes value={preset} sourceSize={sourceSize} autoRotate={autoRotate} disabled={resizeMatchLargest} onChange={setPreset} />
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("tools.pages.paperSize")}>
          <SelectInput value={preset} disabled={resizeMatchLargest} onChange={(event) => setPreset(event.target.value)}>
            {PAPER_SIZE_OPTIONS.map((value) => (
              <option key={value} value={value}>{paperName(value)}</option>
            ))}
            <option value="custom">{t("tools.edit.resize.custom")}</option>
          </SelectInput>
        </Field>
        {preset === "custom" ? (
          <>
            <Field label={t("tools.edit.resize.widthMm")}>
              <TextInput type="number" min={RESIZE_SIDE_MM.min} max={RESIZE_SIDE_MM.max} value={customSize.width} disabled={resizeMatchLargest} aria-invalid={!resizeWidthValid || undefined} onChange={(event) => setCustomSize((state) => ({ ...state, width: Number(event.target.value) }))} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.resize.heightMm")}>
              <TextInput type="number" min={RESIZE_SIDE_MM.min} max={RESIZE_SIDE_MM.max} value={customSize.height} disabled={resizeMatchLargest} aria-invalid={!resizeHeightValid || undefined} onChange={(event) => setCustomSize((state) => ({ ...state, height: Number(event.target.value) }))} className="font-mono" />
            </Field>
          </>
        ) : null}
      </div>
      <OptionCards
        value={resizeMode}
        onChange={setResizeMode}
        ariaLabel={t("tools.edit.resize.mode")}
        options={(["fit", "fill", "stretch", "box"] as ResizeMode[]).map((value) => ({
          value,
          title: t(`tools.edit.resize.modes.${value}`),
          description: t(`tools.edit.resize.modeHints.${value}`),
          preview: <FitPreview mode={value} />,
        }))}
      />
      <Field label={t("tools.edit.resize.margin")}>
        <TextInput type="number" min={RESIZE_MARGIN_MM.min} max={RESIZE_MARGIN_MM.max} value={resizeMargin} disabled={resizeMode === "box"} aria-invalid={!resizeMarginValid || undefined} onChange={(event) => setResizeMargin(Number(event.target.value))} className="w-40 font-mono" />
      </Field>
      <SwitchField label={t("tools.edit.resize.matchLargest")} hint={t("tools.edit.resize.matchLargestHint")} checked={resizeMatchLargest} onChange={setResizeMatchLargest} />
      <Checkbox label={t("tools.edit.resize.autoRotate")} checked={autoRotate} onChange={setAutoRotate} />
      <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
        <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="w-64 font-mono" />
      </Field>
    </Section>
  );
}
