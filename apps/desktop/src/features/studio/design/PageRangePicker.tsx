import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Segmented, TextInput } from "@/components/tool/form";
import { PAGE_CHOICES, type PageChoice, type PageSelection } from "./exportPages";

export function PageRangePicker({ choice, custom, onChoice, onCustom, pageCount, currentIndex, selection, disabled }: {
  choice: PageChoice;
  custom: string;
  onChoice: (choice: PageChoice) => void;
  onCustom: (value: string) => void;
  pageCount: number;
  currentIndex: number;
  selection: PageSelection;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const error = choice === "custom" && !selection.ok ? selection.error : null;
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-foreground/80">{t("studio.export.pages")}</span>
      <Segmented
        size="sm"
        value={choice}
        options={PAGE_CHOICES}
        labelOf={(value) => (value === "all" ? t("studio.export.pagesAll", { count: pageCount }) : value === "current" ? t("studio.export.pagesCurrent", { page: currentIndex + 1 }) : t("studio.export.pagesCustom"))}
        onChange={onChoice}
        ariaLabel={t("studio.export.pages")}
      />
      {choice === "custom" ? (
        <>
          <TextInput
            value={custom}
            maxLength={400}
            onChange={(event) => onCustom(event.target.value)}
            placeholder={t("studio.export.rangePlaceholder")}
            aria-label={t("studio.export.pagesCustom")}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            disabled={disabled}
            className="font-mono text-sm"
            data-testid="studio-export-range"
          />
          <p id={errorId} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"} aria-live="polite">
            {error ? t(`studio.export.rangeErrors.${error}`, { last: pageCount }) : t("studio.export.rangeHint", { last: pageCount })}
          </p>
        </>
      ) : null}
    </div>
  );
}
