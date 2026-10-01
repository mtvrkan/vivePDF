import { useCallback, useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { PageGrid } from "@/components/tool/PageGrid";
import { cutsToRanges, rangesToCuts } from "./splitParts";

type CutPickerDialogProps = {
  open: boolean;
  path: string;
  password?: string;
  pageCount: number;
  ranges: string;
  onClose: () => void;
  onApply: (ranges: string) => void;
};

export function CutPickerDialog({ open, path, password, pageCount, ranges, onClose, onApply }: CutPickerDialogProps) {
  const { t } = useTranslation();
  const [starts, setStarts] = useState<Set<number>>(() => new Set(rangesToCuts(ranges, pageCount)));

  useEffect(() => {
    if (open) setStarts(new Set(rangesToCuts(ranges, pageCount)));
  }, [open, ranges, pageCount]);

  const toggle = useCallback((page: number) => {
    if (page === 1) return;
    setStarts((state) => {
      const next = new Set(state);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  const sorted = [...starts].sort((left, right) => left - right);
  const partOf = (page: number) => sorted.filter((start) => start <= page).length + 1;
  const partCount = sorted.length + 1;

  return (
    <Dialog
      open={open}
      title={t("tools.split.cuts.title")}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={partCount < 2} onClick={() => onApply(cutsToRanges(sorted, pageCount))}>
            {t("tools.split.cuts.apply", { count: partCount })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{t("tools.split.cuts.hint")}</p>
          <Button size="sm" variant="ghost" className="ms-auto" disabled={starts.size === 0} onClick={() => setStarts(new Set())}>
            {t("tools.split.cuts.clear")}
          </Button>
          <span role="status" className="text-sm text-muted-foreground">
            {t("tools.split.cuts.count", { count: partCount })}
          </span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto pe-1">
          <PageGrid
            path={path}
            password={password}
            pageCount={pageCount}
            dimInactive={false}
            isActive={(page) => starts.has(page)}
            labelOf={(page) => (page === 1 ? t("tools.split.cuts.firstPage") : starts.has(page) ? t("tools.split.cuts.removeCut", { page }) : t("tools.split.cuts.addCut", { page }))}
            badgeOf={(page) =>
              page === 1 || starts.has(page) ? (
                <span aria-hidden className="pointer-events-none absolute start-2.5 top-2.5 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
                  {page === 1 ? null : <Scissors className="size-3" />}
                  {partOf(page)}
                </span>
              ) : null
            }
            onPress={(page) => toggle(page)}
          />
        </div>
      </div>
    </Dialog>
  );
}
