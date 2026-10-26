import { useTranslation } from "react-i18next";
import { Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import type { ThesisCheckRules, ThesisNumberPlace, ThesisPaper } from "@/types";
import { clampRule, LIMITS, MARGIN_SIDES, presetOf, presetRules, THESIS_NUMBER_PLACES, THESIS_PAPERS, THESIS_PRESETS, type ThesisPreset } from "./thesisCheckRules";

type Props = {
  rules: ThesisCheckRules;
  onChange: (rules: ThesisCheckRules) => void;
  disabled?: boolean;
};

export function ThesisRulesForm({ rules, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const preset = presetOf(rules);
  const choose = (next: ThesisPreset) => {
    if (next !== "custom") onChange(presetRules(next));
  };
  const number = (value: string, limits: readonly [number, number]) => clampRule(Number(value), limits);

  return (
    <Section title={t("tools.thesisCheck.rules")}>
      <OptionCards
        value={preset}
        onChange={choose}
        disabled={disabled}
        ariaLabel={t("tools.thesisCheck.rules")}
        options={THESIS_PRESETS.map((value) => ({
          value,
          title: t(`tools.thesisCheck.presets.${value}.title`),
          description: t(`tools.thesisCheck.presets.${value}.description`),
        }))}
      />
      <div className="grid grid-cols-2 gap-3" data-thesis-rules>
        {MARGIN_SIDES.map((side) => (
          <Field key={side} label={t(`tools.thesisCheck.margins.${side}`)}>
            <TextInput
              type="number"
              min={LIMITS.margin[0]}
              max={LIMITS.margin[1]}
              step={0.5}
              value={rules.marginsMm[side]}
              disabled={disabled}
              data-thesis-margin={side}
              onChange={(event) => onChange({ ...rules, marginsMm: { ...rules.marginsMm, [side]: number(event.target.value, LIMITS.margin) } })}
              className="font-mono"
            />
          </Field>
        ))}
        <Field label={t("tools.thesisCheck.fontFamily")} hint={t("tools.thesisCheck.fontFamilyHint")}>
          <TextInput value={rules.fontFamily} maxLength={80} disabled={disabled} onChange={(event) => onChange({ ...rules, fontFamily: event.target.value })} />
        </Field>
        <Field label={t("tools.thesisCheck.fontSize")}>
          <TextInput
            type="number"
            min={LIMITS.fontSize[0]}
            max={LIMITS.fontSize[1]}
            step={0.5}
            value={rules.fontSize}
            disabled={disabled}
            onChange={(event) => onChange({ ...rules, fontSize: number(event.target.value, LIMITS.fontSize) })}
            className="font-mono"
          />
        </Field>
        <Field label={t("tools.thesisCheck.lineHeight")}>
          <TextInput
            type="number"
            min={LIMITS.lineHeight[0]}
            max={LIMITS.lineHeight[1]}
            step={0.05}
            value={rules.lineHeight}
            disabled={disabled}
            onChange={(event) => onChange({ ...rules, lineHeight: number(event.target.value, LIMITS.lineHeight) })}
            className="font-mono"
          />
        </Field>
        <Field label={t("tools.thesisCheck.pageNumbers")}>
          <SelectInput value={rules.pageNumbers} disabled={disabled} onChange={(event) => onChange({ ...rules, pageNumbers: event.target.value as ThesisNumberPlace })}>
            {THESIS_NUMBER_PLACES.map((place) => (
              <option key={place} value={place}>
                {t(`tools.thesisCheck.places.${place}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.thesisCheck.paper")}>
          <SelectInput value={rules.paper} disabled={disabled} onChange={(event) => onChange({ ...rules, paper: event.target.value as ThesisPaper })}>
            {THESIS_PAPERS.map((paper) => (
              <option key={paper} value={paper}>
                {t(`tools.thesisCheck.papers.${paper}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <SwitchField label={t("tools.thesisCheck.frontRoman")} checked={rules.frontRoman} disabled={disabled} onChange={(frontRoman) => onChange({ ...rules, frontRoman })} />
      <SwitchField label={t("tools.thesisCheck.mirrored")} hint={t("tools.thesisCheck.mirroredHint")} checked={rules.mirrored} disabled={disabled} onChange={(mirrored) => onChange({ ...rules, mirrored })} />
    </Section>
  );
}
