import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, SelectInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { detectPhotoPaper } from "@/shared/rpc/operations";
import type { ScanPhotoDetectResult } from "@/types";
import { cornersFor, nudgeCorner, pointFromClient, sameCorners, withFrameCorners, type Corner, type FrameSize, type PhotoCornerState } from "./cornerGeometry";

const CORNER_NAMES = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

type PhotoCornerEditorProps = {
  path: string;
  state: PhotoCornerState;
  onChange: (state: PhotoCornerState) => void;
  onClose: () => void;
  disabled?: boolean;
};

export function PhotoCornerEditor({ path, state, onChange, onClose, disabled = false }: PhotoCornerEditorProps) {
  const { t } = useTranslation();
  const [detection, setDetection] = useState<ScanPhotoDetectResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [frameCount, setFrameCount] = useState(1);
  const [applyAll, setApplyAll] = useState(() => Object.keys(state.frames).length === 0);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetection(null);
    setMessage(null);
    void detectPhotoPaper({ image: path, frame })
      .then((result) => {
        if (cancelled) return;
        setDetection(result);
        setFrameCount(result.frames);
      })
      .catch((error) => {
        if (!cancelled) setMessage(describeError(t, toRpcError(error)));
      });
    return () => {
      cancelled = true;
    };
  }, [path, frame, t]);

  const detected = detection ? (detection.corners as Corner[]) : null;
  const size: FrameSize | undefined = detection ? [detection.width, detection.height] : undefined;
  const corners = cornersFor(state, frame, applyAll, size);
  const shown = corners ?? detected;

  const commit = (next: Corner[]) => onChange(withFrameCorners(state, frame, applyAll, sameCorners(next, detected) ? null : next, size));

  const moveTo = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (!detection || !shown || !frameRef.current) return;
    const point = pointFromClient(event.clientX, event.clientY, frameRef.current.getBoundingClientRect(), detection.width, detection.height);
    commit(shown.map((corner, position) => (position === index ? point : corner)));
  };

  const onKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!detection || !shown) return;
    const next = nudgeCorner(shown, index, event.key, event.shiftKey, detection.width, detection.height);
    if (!next) return;
    event.preventDefault();
    commit(next);
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>{t("tools.scan.photo.corners.title", { name: basenameOf(path) })}</p>
        {!detection && !message ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>
      {frameCount > 1 ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("tools.scan.photo.corners.frame")}>
            <SelectInput value={String(frame)} onChange={(event) => setFrame(Number(event.target.value))} disabled={disabled} className="w-40">
              {Array.from({ length: frameCount }, (_unused, index) => (
                <option key={index} value={index}>{t("tools.scan.photo.corners.frameOption", { current: index + 1, total: frameCount })}</option>
              ))}
            </SelectInput>
          </Field>
          <Checkbox
            label={t("tools.scan.photo.corners.allFrames")}
            checked={applyAll}
            onChange={(checked) => {
              setApplyAll(checked);
              if (checked) onChange(withFrameCorners(state, frame, true, cornersFor(state, frame, false, size), size));
            }}
            disabled={disabled}
          />
        </div>
      ) : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      {!detection && !message ? <div className="aspect-[4/3] w-full animate-pulse rounded-md border bg-muted" aria-busy /> : null}
      {detection && shown ? (
        <>
          <p className={cn("text-xs", detection.detected ? "text-muted-foreground" : "text-warning")} aria-live="polite">
            {detection.detected ? t("tools.scan.photo.corners.detected") : t("tools.scan.photo.corners.notDetected")}
          </p>
          <div ref={frameRef} className="relative mx-auto w-full touch-none select-none overflow-visible rounded-md border bg-muted" style={{ aspectRatio: `${detection.previewWidth} / ${detection.previewHeight}` }}>
            <img src={`data:image/jpeg;base64,${detection.preview}`} alt={t("tools.scan.photo.corners.previewAlt")} className="absolute inset-0 size-full rounded-md object-fill" draggable={false} />
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${detection.width} ${detection.height}`} preserveAspectRatio="none" aria-hidden>
              <polygon points={shown.map(([x, y]) => `${x},${y}`).join(" ")} className="fill-primary/15 stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            {shown.map(([x, y], index) => (
              <button
                key={CORNER_NAMES[index]}
                type="button"
                disabled={disabled}
                aria-label={t("tools.scan.photo.corners.handle", { corner: t(`tools.scan.photo.corners.names.${CORNER_NAMES[index]}`) })}
                title={t("tools.scan.photo.corners.handleHint")}
                className={cn(
                  "absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-background shadow-(--shadow-card) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                  dragging === index && "cursor-grabbing bg-primary",
                )}
                style={{ left: `${(x / detection.width) * 100}%`, top: `${(y / detection.height) * 100}%` }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(index);
                }}
                onPointerMove={(event) => {
                  if (dragging === index) moveTo(index, event);
                }}
                onPointerUp={(event) => {
                  if (dragging === index) moveTo(index, event);
                  setDragging(null);
                }}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(event) => onKey(index, event)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("tools.scan.photo.corners.hint")}</p>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => onChange(withFrameCorners(state, frame, applyAll, null, size))} disabled={disabled || corners === null}>
          {t("tools.scan.photo.corners.reset")}
        </Button>
        <Button onClick={onClose}>{t("tools.scan.photo.corners.done")}</Button>
      </div>
    </div>
  );
}
