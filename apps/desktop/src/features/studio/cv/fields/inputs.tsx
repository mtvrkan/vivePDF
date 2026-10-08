import { useId, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Field, TextArea, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { CV_TEXT_LIMIT, MAX_LEVEL } from "../cvModel";
import { looksValid, type ValueCheck } from "./fieldChecks";

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  placeholder?: string;
  hint?: string;
  check?: ValueCheck;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  className?: string;
};

export function TextField({ label, value, onChange, max = 200, placeholder, hint, check, inputRef, onKeyDown, onPaste, className }: TextFieldProps) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  const invalid = check !== undefined && touched && !looksValid(check, value);
  return (
    <Field label={label} hint={hint} className={className} note={invalid ? <p className="mt-1 text-xs text-warning">{t(`studio.cv.checks.${check}`)}</p> : undefined}>
      <TextInput ref={inputRef} value={value} maxLength={max} placeholder={placeholder} aria-invalid={invalid || undefined} onBlur={() => setTouched(true)} onKeyDown={onKeyDown} onPaste={onPaste} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function ParagraphField({ label, value, onChange, hint, placeholder, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; rows?: number }) {
  return (
    <Field label={label} hint={hint}>
      <TextArea value={value} rows={rows} maxLength={CV_TEXT_LIMIT} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function LevelPicker({ label, value, onChange, labels }: { label: string; value: number; onChange: (value: number) => void; labels: string[] }) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-labelledby={labelId}>
      <span id={labelId} className="sr-only">
        {label}
      </span>
      {Array.from({ length: MAX_LEVEL }, (_, index) => {
        const level = index + 1;
        const active = level <= value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            title={labels[index]}
            aria-label={labels[index]}
            onClick={() => onChange(value === level ? 0 : level)}
            className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("size-3.5 rounded-full border", active ? "border-primary bg-primary" : "border-border bg-transparent")} />
          </button>
        );
      })}
      <span className="ms-1 min-w-0 truncate text-xs text-muted-foreground">{value > 0 ? labels[value - 1] : t("studio.cv.noLevel")}</span>
    </div>
  );
}
