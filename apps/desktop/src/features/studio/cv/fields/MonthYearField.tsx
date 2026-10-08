import { useEffect, useId, useState } from "react";
import { CalendarDays, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { SelectInput, TextInput } from "@/components/tool/form";
import { useCvStore } from "../cvStore";
import { formatMonthYear, monthNames, parseMonthYear } from "../cvDates";

type MonthYearFieldProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; placeholder?: string };

export function MonthYearField({ label, value, onChange, disabled, placeholder }: MonthYearFieldProps) {
  const { t } = useTranslation();
  const language = useCvStore((state) => state.theme.language);
  const labelId = useId();
  const parsed = parseMonthYear(value, language);
  const [typing, setTyping] = useState(() => value.trim() !== "" && parsed === null);
  const [yearDraft, setYearDraft] = useState(parsed ? String(parsed.year) : "");
  const shownYear = parsed ? String(parsed.year) : "";
  useEffect(() => setYearDraft(shownYear), [shownYear]);
  const shownMonth = parsed?.month ?? null;
  const [month, setMonth] = useState<number | null>(shownMonth);
  useEffect(() => setMonth(shownMonth), [shownMonth]);
  const months = monthNames(language, "long");

  const write = (nextMonth: number | null, yearText: string) => {
    const year = Number(yearText);
    if (/^\d{4}$/.test(yearText) && year >= 1900 && year <= 2100) onChange(formatMonthYear({ month: nextMonth, year }, language));
    else if (!yearText.trim() && nextMonth === null) onChange("");
  };

  return (
    <div role="group" aria-labelledby={labelId} className="min-w-0">
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-foreground/80">
        {label}
      </span>
      {typing ? (
        <div className="flex items-center gap-1">
          <TextInput aria-label={label} value={value} maxLength={40} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          <IconButton icon={CalendarDays} disabled={disabled} label={t("studio.cv.dates.pick")} onClick={() => setTyping(false)} />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <SelectInput aria-label={t("studio.cv.dates.month", { name: label })} value={month === null ? "" : String(month)} disabled={disabled} onChange={(event) => {
              const next = event.target.value ? Number(event.target.value) : null;
              setMonth(next);
              write(next, yearDraft);
            }} className="min-w-0 flex-1">
            <option value="">{t("studio.cv.dates.noMonth")}</option>
            {months.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            aria-label={t("studio.cv.dates.year", { name: label })}
            value={yearDraft}
            inputMode="numeric"
            maxLength={4}
            disabled={disabled}
            placeholder={placeholder ?? "2024"}
            className="w-20 shrink-0 tabular-nums"
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 4);
              setYearDraft(next);
              write(month, next);
            }}
          />
          <IconButton icon={Type} disabled={disabled} label={t("studio.cv.dates.type")} onClick={() => setTyping(true)} />
        </div>
      )}
    </div>
  );
}
