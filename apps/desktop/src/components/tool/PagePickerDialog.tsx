import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { PageGrid } from "@/components/tool/PageGrid";
import { rangePages } from "@/shared/lib/pageScope";

type Preset = "all" | "none" | "odd" | "even" | "invert";

const PRESETS: Preset[] = ["all", "none", "odd", "even", "invert"];

function initialSelection(ranges: string, pageCount: number): Set<number> {
  const pages = rangePages(ranges, pageCount) ?? Array.from({ length: pageCount }, (_, index) => index + 1);
  return new Set(pages);
}

type PagePickerDialogProps = {
  open: boolean;
  title: string;
  path: string;
  password?: string;
  pageCount: number;
  ranges: string;
  onClose: () => void;
  onApply: (pages: number[]) => void;
};

export function PagePickerDialog({ open, title, path, password, pageCount, ranges, onClose, onApply }: PagePickerDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<number>>(() => initialSelection(ranges, pageCount));
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(initialSelection(ranges, pageCount));
    anchor.current = null;
  }, [open, ranges, pageCount]);

  const press = useCallback((page: number, event: MouseEvent<HTMLButtonElement>) => {
    setSelected((state) => {
      const next = new Set(state);
      if (event.shiftKey && anchor.current !== null) {
        const on = state.has(anchor.current);
        const [from, to] = anchor.current < page ? [anchor.current, page] : [page, anchor.current];
        for (let value = from; value <= to; value += 1) {
          if (on) next.add(value);
          else next.delete(value);
        }
      } else if (next.has(page)) {
        next.delete(page);
      } else {
        next.add(page);
      }
      return next;
    });
    if (!event.shiftKey) anchor.current = page;
  }, []);

  const applyPreset = (preset: Preset) => {
    const all = Array.from({ length: pageCount }, (_, index) => index + 1);
    setSelected((state) => {
      if (preset === "all") return new Set(all);
      if (preset === "none") return new Set();
      if (preset === "odd") return new Set(all.filter((page) => page % 2 === 1));
      if (preset === "even") return new Set(all.filter((page) => page % 2 === 0));
      return new Set(all.filter((page) => !state.has(page)));
    });
  };

  const count = selected.size;

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={count === 0} onClick={() => onApply([...selected].sort((left, right) => left - right))}>
            {t("tools.pagePicker.apply", { count })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <Button key={preset} size="sm" variant="ghost" onClick={() => applyPreset(preset)}>
              {t(`tools.pagePicker.presets.${preset}`)}
            </Button>
          ))}
          <span role="status" className="ms-auto text-sm text-muted-foreground">
            {t("tools.pagePicker.count", { count, total: pageCount })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("tools.pagePicker.hint")}</p>
        <div className="max-h-[60vh] overflow-y-auto pe-1">
          <PageGrid
            path={path}
            password={password}
            pageCount={pageCount}
            isActive={(page) => selected.has(page)}
            labelOf={(page) => t("tools.pagePicker.page", { page })}
            onPress={press}
          />
        </div>
      </div>
    </Dialog>
  );
}
