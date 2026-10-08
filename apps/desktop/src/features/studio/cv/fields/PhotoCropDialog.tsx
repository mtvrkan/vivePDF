import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { SliderField } from "@/components/tool/form";
import type { StudioCrop } from "@/types/studio";
import type { ImagePreview } from "../../design/assets";
import { clampView, cropOfView, MAX_PHOTO_ZOOM, viewOfCrop, type PhotoView } from "../photoCrop";

const VIEWPORT = 240;
const KEY_STEP = 0.02;

type PhotoCropDialogProps = { open: boolean; image: ImagePreview | null; crop: StudioCrop | null; round: boolean; onClose: () => void; onApply: (crop: StudioCrop | null) => void };

export function PhotoCropDialog({ open, image, crop, round, onClose, onApply }: PhotoCropDialogProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<PhotoView>({ zoom: 1, centerX: 0.5, centerY: 0.5 });
  const drag = useRef<{ x: number; y: number; view: PhotoView } | null>(null);
  useEffect(() => {
    if (open && image) setView(viewOfCrop(crop, image.width, image.height));
  }, [open, image, crop]);
  if (!image) return null;
  const { width, height } = image;
  const side = Math.min(width, height) / view.zoom;
  const scale = VIEWPORT / side;
  const left = VIEWPORT / 2 - view.centerX * width * scale;
  const top = VIEWPORT / 2 - view.centerY * height * scale;
  const update = (next: PhotoView) => setView(clampView(next, width, height));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, view };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    update({ ...start.view, centerX: start.view.centerX - (event.clientX - start.x) / (width * scale), centerY: start.view.centerY - (event.clientY - start.y) / (height * scale) });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const step = (KEY_STEP * (event.shiftKey ? 5 : 1)) / view.zoom;
    update({ ...view, centerX: view.centerX + move[0] * step, centerY: view.centerY + move[1] * step });
  };

  return (
    <Dialog
      open={open}
      title={t("studio.cv.crop.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => onApply(null)}>
            {t("studio.cv.crop.reset")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => onApply(cropOfView(view, width, height))}>
            {t("studio.cv.crop.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          role="application"
          tabIndex={0}
          aria-label={t("studio.cv.crop.area")}
          aria-describedby="cv-crop-hint"
          data-testid="cv-photo-crop"
          className={`relative cursor-grab touch-none select-none overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${round ? "rounded-full" : "rounded-lg"}`}
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          <img src={image.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left, top, width: width * scale, height: height * scale }} />
        </div>
        <p id="cv-crop-hint" className="text-xs text-muted-foreground">
          {t("studio.cv.crop.hint")}
        </p>
        <SliderField label={t("studio.cv.crop.zoom")} value={view.zoom} min={1} max={MAX_PHOTO_ZOOM} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(zoom) => update({ ...view, zoom })} className="w-full" />
      </div>
    </Dialog>
  );
}
