import { ChevronLeft, ChevronRight, RotateCw, ScanLine, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { LazyThumbnail } from "@/components/tool/PageGrid";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";
import { movePage, removePage, rotatePage, type Rotation, type SessionPage } from "./scanSession";

const ROTATION_CLASS: Record<Rotation, string> = { 0: "", 90: "rotate-90", 180: "rotate-180", 270: "-rotate-90" };

type ScanSessionPanelProps = {
  pages: SessionPage[];
  disabled: boolean;
  onChange: (pages: SessionPage[]) => void;
  onClear: () => void;
};

export function ScanSessionPanel({ pages, disabled, onChange, onClear }: ScanSessionPanelProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  if (pages.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t("tools.scan.scanner.session.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span role="status" className="text-muted-foreground">{t("tools.scan.scanner.session.count", { count: pages.length, formatted: formatNumber(pages.length, locale) })}</span>
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={onClear} disabled={disabled}>
          {t("tools.scan.scanner.session.clear")}
        </Button>
      </div>
      <ol className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 overflow-auto rounded-lg border p-3">
        {pages.map((item, index) => {
          const number = index + 1;
          return (
            <li key={item.id} className="flex flex-col gap-1.5" aria-label={t("tools.scan.scanner.session.pageLabel", { page: number })}>
              <div className={cn("transition-transform duration-(--transition-fast)", ROTATION_CLASS[item.rotation])}>
                <LazyThumbnail path={item.path} page={item.page + 1} />
              </div>
              <div className="flex items-center justify-between gap-0.5">
                <span className="w-6 font-mono text-xs tabular-nums text-muted-foreground">{number}</span>
                <IconButton icon={ChevronLeft} className="rtl:-scale-x-100" label={t("tools.scan.scanner.session.moveEarlier", { page: number })} disabled={disabled || index === 0} onClick={() => onChange(movePage(pages, item.id, -1))} />
                <IconButton icon={ChevronRight} className="rtl:-scale-x-100" label={t("tools.scan.scanner.session.moveLater", { page: number })} disabled={disabled || index === pages.length - 1} onClick={() => onChange(movePage(pages, item.id, 1))} />
                <IconButton icon={RotateCw} label={t("tools.scan.scanner.session.rotate", { page: number })} disabled={disabled} onClick={() => onChange(rotatePage(pages, item.id))} />
                <IconButton icon={Trash2} label={t("tools.scan.scanner.session.remove", { page: number })} disabled={disabled} onClick={() => onChange(removePage(pages, item.id))} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
