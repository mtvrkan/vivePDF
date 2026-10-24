import { ChevronLeft, ChevronRight, FileX2, RotateCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import type { PrintPaper } from "@/types";
import type { PrintPreviewState } from "./usePrintPreview";

const PAPER_RATIOS: Record<PrintPaper, string> = { a4: "210 / 297", letter: "8.5 / 11" };
const PAPER_LABELS: Record<PrintPaper, string> = { a4: "A4", letter: "Letter" };

export function PrintPreviewPane({ preview, paper }: { preview: PrintPreviewState; paper: PrintPaper }) {
  const { t } = useTranslation();
  const { status, result, error, sheet, setSheet, retry } = preview;
  const total = result?.sheets ?? 0;
  const shown = status === "ready" || (status === "loading" && result !== null);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t("viewer.printDialog.previewTitle")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t("viewer.printDialog.previewTitle")}</h3>
        <span className="rounded-full border px-2 py-0.5 text-2xs font-medium text-muted-foreground">{PAPER_LABELS[paper]}</span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-muted/60 p-4">
        <div className="paper-surface relative w-full max-w-72 overflow-hidden rounded-sm bg-card shadow-(--shadow-card)" style={{ aspectRatio: result ? `${result.width} / ${result.height}` : PAPER_RATIOS[paper] }} aria-busy={status === "loading"}>
          {shown && result ? (
            <img
              src={`data:image/jpeg;base64,${result.image}`}
              width={result.width}
              height={result.height}
              alt={t("viewer.printDialog.previewAlt", { current: result.sheet + 1, total: result.sheets })}
              className={cn("block size-full transition-opacity duration-(--transition-fast)", status === "loading" ? "opacity-60" : "opacity-100")}
              draggable={false}
            />
          ) : null}
          {status === "loading" && !result ? <div className="absolute inset-3 animate-pulse rounded-sm bg-muted" /> : null}
          {status === "empty" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card p-4 text-center">
              <FileX2 className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t("viewer.printDialog.previewEmpty")}</p>
              <p className="text-xs text-muted-foreground">{t("viewer.printDialog.previewEmptyHint")}</p>
            </div>
          ) : null}
          {status === "error" && error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card p-4 text-center" role="alert">
              <TriangleAlert className="size-8 text-warning" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t("viewer.printDialog.previewFailed")}</p>
              <p className="text-xs text-muted-foreground">{describeError(t, error)}</p>
              <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" aria-hidden />} onClick={retry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <IconButton icon={ChevronLeft} label={t("viewer.printDialog.previousSheet")} onClick={() => setSheet(Math.max(0, (result?.sheet ?? sheet) - 1))} disabled={status !== "ready" || !result || result.sheet === 0} className="rtl:rotate-180" />
        <div className="min-w-0 text-center" aria-live="polite">
          <p className="text-xs font-medium tabular-nums text-foreground">{result && status !== "empty" ? t("viewer.printDialog.sheetOf", { current: result.sheet + 1, total }) : " "}</p>
          <p className="truncate text-2xs text-muted-foreground">{result && status !== "empty" ? t("viewer.printDialog.previewPages", { pages: result.pages.join(", ") }) : " "}</p>
        </div>
        <IconButton icon={ChevronRight} label={t("viewer.printDialog.nextSheet")} onClick={() => setSheet(Math.min(total - 1, (result?.sheet ?? sheet) + 1))} disabled={status !== "ready" || !result || result.sheet >= total - 1} className="rtl:rotate-180" />
      </div>
    </section>
  );
}
