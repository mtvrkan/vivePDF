import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { StudioGuide } from "@/types/studio";
import { PAD } from "./canvasGeometry";

type GuideLinesProps = { guides: StudioGuide[]; pageLeft: string; zoom: number; movingGuide: { index: number; removing: boolean } | null };

export function GuideLines({ guides, pageLeft, zoom, movingGuide }: GuideLinesProps) {
  const { t } = useTranslation();
  if (!guides.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {guides.map((guide, index) => {
        const vertical = guide.axis === "x";
        const fading = movingGuide?.index === index && movingGuide.removing;
        return (
          <div
            key={index}
            data-guide={index}
            data-axis={guide.axis}
            data-testid="studio-guide"
            title={t("studio.view.guideHint")}
            className={cn("pointer-events-auto absolute flex justify-center", vertical ? "inset-y-0 w-2 -translate-x-1/2 cursor-col-resize" : "inset-x-0 h-2 -translate-y-1/2 flex-col cursor-row-resize")}
            style={vertical ? { left: `calc(${pageLeft} + ${guide.position * zoom}px)` } : { top: PAD + guide.position * zoom }}
          >
            <span className={cn(vertical ? "h-full w-px" : "h-px w-full", fading ? "bg-success/30" : "bg-success")} />
          </div>
        );
      })}
    </div>
  );
}
