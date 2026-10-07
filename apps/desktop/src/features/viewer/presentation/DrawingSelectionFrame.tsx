import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { drawingBounds } from "@/shared/lib/drawingGeometry";
import type { Stroke } from "@/shared/store/presentationStore";
import { arrowHeadLength } from "./strokes";
import type { PageRect } from "./usePageRects";

const FRAME_GAP_PX = 6;

export function DrawingSelectionFrame({ rect, stroke, onDelete }: { rect: PageRect; stroke: Stroke; onDelete: () => void }) {
  const { t } = useTranslation();
  const bounds = drawingBounds(stroke, { x: rect.width, y: rect.height });
  const gap = FRAME_GAP_PX + (stroke.tool === "arrow" ? arrowHeadLength(stroke.width * rect.width) / 2 : 0);
  const left = rect.left + bounds.left - gap;
  const top = rect.top + bounds.top - gap;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        data-presentation-selection=""
        className="absolute rounded-md outline-dashed outline-1 outline-primary"
        style={{ left, top, width: bounds.right - bounds.left + gap * 2, height: bounds.bottom - bounds.top + gap * 2 }}
      >
        <IconButton
          icon={Trash2}
          label={t("presentation.deleteDrawing")}
          shortcut="Del"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onDelete}
          className="glass pointer-events-auto absolute -top-1 right-0 -translate-y-full"
        />
      </div>
    </div>
  );
}
