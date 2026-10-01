import { Image, Layers, RefreshCw, ScanLine, ScanSearch, Shapes, Stamp, StickyNote, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import type { RpcError, WatermarkCandidate } from "@/types";

type WatermarkFinderProps = {
  candidates: WatermarkCandidate[] | null;
  chosen: Record<string, boolean>;
  scanning: boolean;
  error: RpcError | null;
  pagesScanned: number;
  onToggle: (id: string, value: boolean) => void;
  onRescan: () => void;
};

const EXACT_KINDS = new Set<WatermarkCandidate["kind"]>(["tagged", "artifact", "layer", "annotation", "stampAnnotation"]);

const ICONS = {
  text: Type,
  image: Image,
  annotation: StickyNote,
  stampAnnotation: Stamp,
  tagged: Stamp,
  artifact: Shapes,
  layer: Layers,
  raster: ScanLine,
} as const;

function labelOf(candidate: WatermarkCandidate, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (candidate.kind === "text") return `“${candidate.text ?? ""}”`;
  if (candidate.kind === "layer") return t("tools.security.removeWatermark.finder.layer", { name: candidate.text || "—" });
  return t(`tools.security.removeWatermark.finder.${candidate.kind}`);
}

export function WatermarkFinder({ candidates, chosen, scanning, error, pagesScanned, onToggle, onRescan }: WatermarkFinderProps) {
  const { t } = useTranslation();
  const ordered = [...(candidates ?? [])].sort((first, second) => Number(EXACT_KINDS.has(second.kind)) - Number(EXACT_KINDS.has(first.kind)));

  const meta = (candidate: WatermarkCandidate) => {
    const parts = [t("tools.security.removeWatermark.finder.pages", { count: candidate.pages })];
    if (candidate.rotated) parts.push(t("tools.security.removeWatermark.finder.rotated"));
    if (candidate.kind === "text" && candidate.faint) parts.push(t("tools.security.removeWatermark.finder.faint"));
    if (candidate.kind === "image" && candidate.width && candidate.height) parts.push(`${candidate.width}×${candidate.height}`);
    if (candidate.kind === "raster" && candidate.coverage) parts.push(t("tools.security.removeWatermark.finder.share", { percent: Math.max(1, Math.round(candidate.coverage * 100)) }));
    if (candidate.kind === "raster") parts.push(t("tools.security.removeWatermark.finder.rasterHint"));
    if (!candidate.confident && candidate.kind !== "raster") parts.push(t("tools.security.removeWatermark.finder.unsure"));
    return parts.join(" · ");
  };

  return (
    <div className="rounded-xl border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ScanSearch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium">{t("tools.security.removeWatermark.finder.title")}</p>
        {pagesScanned > 0 && !scanning ? <p className="shrink-0 text-xs text-muted-foreground">{t("tools.security.removeWatermark.finder.scanned", { count: pagesScanned })}</p> : null}
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRescan} disabled={scanning} aria-label={t("tools.security.removeWatermark.finder.rescan")} />
      </div>
      {scanning ? <p className="px-3 py-3 text-sm text-muted-foreground">{t("tools.security.removeWatermark.finder.scanning")}</p> : null}
      {!scanning && error ? <p className="px-3 py-3 text-sm text-destructive">{describeError(t, error)}</p> : null}
      {!scanning && !error && candidates !== null && candidates.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">{t("tools.security.removeWatermark.finder.empty")}</p> : null}
      {!scanning && !error && ordered.length > 0 ? (
        <ul>
          {ordered.map((candidate) => {
            const Icon = ICONS[candidate.kind];
            const exact = EXACT_KINDS.has(candidate.kind);
            return (
              <li key={candidate.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", exact ? "tone-tile" : "bg-secondary text-muted-foreground")}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <Checkbox label={labelOf(candidate, t)} hint={meta(candidate)} checked={chosen[candidate.id] ?? false} onChange={(value) => onToggle(candidate.id, value)} />
                </span>
                {exact ? <span className="glass-chip shrink-0 text-[11px] font-medium">{t("tools.security.removeWatermark.finder.exact")}</span> : null}
                {candidate.preview ? (
                  <img
                    src={`data:image/png;base64,${candidate.preview}`}
                    alt=""
                    className={cn("shrink-0 rounded-md border bg-card object-contain p-0.5", candidate.kind === "raster" ? "h-20 w-14" : "size-10")}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
