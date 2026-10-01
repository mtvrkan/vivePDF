import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf } from "@/shared/lib/paths";
import { useUiStore } from "@/shared/store/uiStore";
import type { OmrScan } from "@/types";
import { bookletLetter, optionLetter, sourceLabel, type GradedScan, type ReviewItem, type ScanOverride } from "./omrModel";

const BLANK = -1;

function sheetName(scan: OmrScan, index: number, t: (key: string, values?: Record<string, unknown>) => string): string {
  return t("tools.omr.results.sheetName", { number: index + 1, source: sourceLabel(scan, basenameOf) });
}

function StudentIdFix({ read, onCommit, label }: { read: string; onCommit: (value: string) => void; label: string }) {
  const [value, setValue] = useState(read);
  return (
    <TextInput
      value={value}
      aria-label={label}
      inputMode="numeric"
      maxLength={12}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value.trim() && value !== read) onCommit(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && value.trim() && value !== read) onCommit(value.trim());
      }}
      className="w-36 font-mono"
    />
  );
}

function ChoiceButtons({ label, choices, labelOf, highlighted, onPick }: { label: string; choices: number[]; labelOf: (choice: number) => string; highlighted: readonly number[]; onPick: (choice: number) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          onClick={() => onPick(choice)}
          className={cn(
            "h-7 min-w-7 rounded-md border px-2 text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
            highlighted.includes(choice) ? "border-warning text-foreground" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {labelOf(choice)}
        </button>
      ))}
    </div>
  );
}

export function OmrReview({ items, scans, onOverride }: { items: ReviewItem[]; scans: readonly OmrScan[]; onOverride: (scan: number, change: ScanOverride) => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label={t("tools.omr.review.title")}>
      {items.map((item) => {
        const scan = scans[item.scan];
        const name = sheetName(scan, item.scan, t);
        const key = `${item.kind}-${item.scan}-${item.kind === "question" ? item.question : ""}`;
        return (
          <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
            <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{name}</span>
              <span className="ms-2 text-muted-foreground">
                {item.kind === "question"
                  ? t("tools.omr.review.question", { number: item.question + 1, letters: item.candidates.map((option) => optionLetter(option, scan.letterCase === "lower")).join(", ") })
                  : item.kind === "booklet"
                    ? t("tools.omr.review.booklet")
                    : t("tools.omr.review.studentId", { read: item.read })}
              </span>
            </span>
            {item.kind === "question" ? (
              <ChoiceButtons
                label={t("tools.omr.review.pick", { name, number: item.question + 1 })}
                choices={[...Array.from({ length: scan.options }, (_, option) => option), BLANK]}
                labelOf={(option) => (option === BLANK ? t("tools.omr.review.blank") : optionLetter(option, scan.letterCase === "lower"))}
                highlighted={item.candidates}
                onPick={(option) => onOverride(item.scan, { answers: { [item.question]: option === BLANK ? [] : [option] } })}
              />
            ) : item.kind === "booklet" ? (
              <ChoiceButtons
                label={t("tools.omr.review.pickBooklet", { name })}
                choices={Array.from({ length: scan.booklets }, (_, index) => index)}
                labelOf={bookletLetter}
                highlighted={scan.booklet?.chosen ?? []}
                onPick={(booklet) => onOverride(item.scan, { booklet })}
              />
            ) : (
              <StudentIdFix read={item.read} label={t("tools.omr.review.fixStudentId", { name })} onCommit={(studentId) => onOverride(item.scan, { studentId })} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OmrTable({ graded }: { graded: readonly GradedScan[] }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const number = (value: number) => formatNumber(value, locale);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("tools.omr.results.caption")}</caption>
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {["student", "source", "booklet", "correct", "wrong", "blank", "net", "percent"].map((column) => (
              <th key={column} scope="col" className="px-3 py-2 text-start font-medium">
                {t(`tools.omr.results.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {graded.map((sheet) => (
            <tr key={sheet.index} className="border-t">
              <td className="px-3 py-1.5 font-mono tabular-nums">{sheet.studentId || "—"}</td>
              <td className="max-w-48 truncate px-3 py-1.5 text-muted-foreground" title={sheet.scan.source}>
                {sourceLabel(sheet.scan, basenameOf)}
              </td>
              <td className="px-3 py-1.5">{sheet.booklet === null ? "?" : bookletLetter(sheet.booklet)}</td>
              <td className="px-3 py-1.5 tabular-nums">{number(sheet.correct)}</td>
              <td className="px-3 py-1.5 tabular-nums">{number(sheet.wrong)}</td>
              <td className="px-3 py-1.5 tabular-nums">{number(sheet.blank)}</td>
              <td className="px-3 py-1.5 font-medium tabular-nums">{number(sheet.net)}</td>
              <td className="px-3 py-1.5 tabular-nums">{number(sheet.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
