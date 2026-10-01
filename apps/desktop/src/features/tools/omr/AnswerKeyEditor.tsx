import { useId, useState } from "react";
import { Ban, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Field, Segmented, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { applyKeyText, bookletLetter, filledKeyCount, keyText, optionLetter, toggleKeyOption, type AnswerKey, type KeyCell } from "./omrModel";

type Props = {
  value: AnswerKey;
  options: number;
  onChange: (key: AnswerKey) => void;
  viewerAnswers: number;
  onUseViewerAnswers: (booklet: number) => void;
  disabled?: boolean;
};

export function AnswerKeyEditor({ value, options, onChange, viewerAnswers, onUseViewerAnswers, disabled }: Props) {
  const { t } = useTranslation();
  const hintId = useId();
  const [booklet, setBooklet] = useState(0);
  const [draft, setDraft] = useState<{ booklet: number; text: string; invalid: string[] } | null>(null);
  const active = Math.min(booklet, value.length - 1);
  const row = value[active] ?? [];
  const shownText = draft && draft.booklet === active ? draft.text : keyText(row);
  const invalid = draft && draft.booklet === active ? draft.invalid : [];

  const setRow = (next: KeyCell[]) => onChange(value.map((current, index) => (index === active ? next : current)));
  const setCell = (question: number, cell: KeyCell) => setRow(row.map((current, index) => (index === question ? cell : current)));

  const typeKey = (text: string) => {
    const parsed = applyKeyText(row, text, options);
    setDraft({ booklet: active, text, invalid: parsed.invalid });
    setRow(parsed.cells);
  };

  return (
    <div className="flex flex-col gap-3">
      {value.length > 1 ? (
        <Segmented
          value={active}
          options={value.map((_, index) => index)}
          labelOf={(index) => t("tools.omr.key.bookletTab", { letter: bookletLetter(index) })}
          onChange={(index) => {
            setBooklet(index);
            setDraft(null);
          }}
          ariaLabel={t("tools.omr.key.booklet")}
          size="sm"
          className="self-start"
        />
      ) : null}
      <Field label={t("tools.omr.key.text")} hint={t("tools.omr.key.textHint")}>
        <TextInput
          value={shownText}
          onChange={(event) => typeKey(event.target.value)}
          onBlur={() => setDraft(null)}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          dir="ltr"
          disabled={disabled}
          aria-invalid={invalid.length > 0 || undefined}
          aria-describedby={invalid.length > 0 ? hintId : undefined}
          className="font-mono tracking-wider"
        />
      </Field>
      {invalid.length > 0 ? (
        <p id={hintId} className="text-xs text-destructive">
          {t("tools.omr.key.invalid", { characters: invalid.join(" ") })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{t("tools.omr.key.filled", { filled: filledKeyCount(row), total: row.length })}</span>
        {viewerAnswers > 0 ? (
          <Button size="sm" variant="ghost" icon={<ListChecks className="size-4" aria-hidden />} onClick={() => onUseViewerAnswers(active)} disabled={disabled}>
            {t("tools.omr.key.fromViewer", { count: viewerAnswers })}
          </Button>
        ) : null}
      </div>
      <ol className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-1 overflow-y-auto pe-1" aria-label={t("tools.omr.key.grid")}>
        {row.map((cell, question) => (
          <li key={question} className="flex items-center gap-1">
            <span className="w-7 shrink-0 text-end font-mono text-xs tabular-nums text-muted-foreground">{question + 1}</span>
            {Array.from({ length: options }, (_, option) => {
              const pressed = cell.kind === "answer" && cell.options.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled || cell.kind === "void"}
                  aria-pressed={pressed}
                  aria-label={t("tools.omr.key.option", { question: question + 1, letter: optionLetter(option) })}
                  onClick={() => setCell(question, toggleKeyOption(cell, option))}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-xs font-medium outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                    pressed ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-foreground",
                  )}
                >
                  {optionLetter(option)}
                </button>
              );
            })}
            <button
              type="button"
              disabled={disabled}
              aria-pressed={cell.kind === "void"}
              aria-label={t("tools.omr.key.cancelQuestion", { question: question + 1 })}
              title={t("tools.omr.key.cancelQuestion", { question: question + 1 })}
              onClick={() => setCell(question, cell.kind === "void" ? { kind: "unset" } : { kind: "void" })}
              className={cn(
                "ms-1 flex size-7 items-center justify-center rounded-full outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
                cell.kind === "void" ? "bg-warning/20 text-warning" : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              <Ban className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
