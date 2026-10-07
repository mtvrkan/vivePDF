import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { Eraser, ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { cleanSignature } from "@/shared/rpc/operations";
import { useSignatureStore } from "@/shared/store/signatureStore";
import { useToastStore } from "@/shared/store/toastStore";

const CANVAS_WIDTH = 372;
const CANVAS_HEIGHT = 160;
const PEN_COLORS = ["#101828", "#1d4ed8"];
const PEN_COLOR_LABELS: Record<string, string> = { "#101828": "viewer.signature.penBlack", "#1d4ed8": "viewer.tabGroups.colors.blue" };
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "heic", "heif"];

type SignatureDialogProps = { open: boolean; onClose: () => void; onPick: (id: string) => void };

function trimCanvas(canvas: HTMLCanvasElement): { dataUrl: string; width: number; height: number } | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let top = canvas.height;
  let left = canvas.width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 10) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 6;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(canvas.width - 1, right + pad);
  bottom = Math.min(canvas.height - 1, bottom + pad);
  const trimmed = document.createElement("canvas");
  trimmed.width = right - left + 1;
  trimmed.height = bottom - top + 1;
  trimmed.getContext("2d")?.drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  return { dataUrl: trimmed.toDataURL("image/png"), width: trimmed.width, height: trimmed.height };
}

export function SignatureDialog({ open, onClose, onPick }: SignatureDialogProps) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const items = useSignatureStore((state) => state.items);
  const add = useSignatureStore((state) => state.add);
  const remove = useSignatureStore((state) => state.remove);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(PEN_COLORS[0]);
  const penRoving = useRovingRadios(PEN_COLORS, Math.max(0, PEN_COLORS.indexOf(color)), setColor);
  const [dirty, setDirty] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = CANVAS_WIDTH * ratio;
      canvas.height = CANVAS_HEIGHT * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    setDirty(false);
  }, [open]);

  const positionOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = positionOf(event);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = positionOf(event);
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 1.5 + pressure * 3;
    context.beginPath();
    context.moveTo(lastRef.current.x, lastRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastRef.current = point;
    setDirty(true);
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    lastRef.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    setDirty(false);
  };

  const saveDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const trimmed = trimCanvas(canvas);
    if (!trimmed) return;
    const saved = add({ name: t("viewer.signature.name", { n: items.length + 1 }), ...trimmed });
    onPick(saved.id);
    onClose();
  };

  const importImage = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.scan.photo.images"), extensions: IMAGE_EXTENSIONS }] });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      const result = await cleanSignature({ path: selected });
      const saved = add({ name: t("viewer.signature.name", { n: items.length + 1 }), dataUrl: `data:image/png;base64,${result.pngBase64}`, width: result.width, height: result.height });
      onPick(saved.id);
      onClose();
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t("viewer.signature.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={saveDrawing} disabled={!dirty}>
            {t("viewer.signature.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {items.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("viewer.signature.library")}</span>
            <ul className="grid grid-cols-2 gap-2">
              {items.map((item) => (
                <li key={item.id} className="nav-glass relative rounded-xl p-2">
                  <button
                    type="button"
                    onClick={() => {
                      onPick(item.id);
                      onClose();
                    }}
                    className="flex h-14 w-full items-center justify-center rounded-lg bg-white/90"
                    aria-label={item.name}
                  >
                    <img src={item.dataUrl} alt={item.name} className="max-h-12 max-w-full object-contain" draggable={false} />
                  </button>
                  <IconButton icon={Trash2} label={t("viewer.signature.delete")} className="absolute end-1 top-1" onClick={() => remove(item.id)} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("viewer.signature.draw")}</span>
          <canvas
            ref={canvasRef}
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, touchAction: "none" }}
            className="cursor-crosshair rounded-xl border border-dashed bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <p className="text-xs text-muted-foreground">{t("viewer.signature.hint")}</p>
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label={t("viewer.signature.penColor")} className="flex items-center gap-1.5">
              {PEN_COLORS.map((preset, index) => (
                <button
                  key={preset}
                  ref={penRoving.refOf(index)}
                  type="button"
                  role="radio"
                  aria-checked={color === preset}
                  aria-label={t(PEN_COLOR_LABELS[preset])}
                  tabIndex={penRoving.tabIndexOf(index)}
                  onKeyDown={penRoving.onKeyDown}
                  onClick={() => setColor(preset)}
                  className={cn("size-5 rounded-full border transition-transform duration-(--transition-fast) hover:scale-110", color === preset ? "border-foreground ring-2 ring-ring/40" : "border-border")}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={<Eraser className="size-4" aria-hidden />} onClick={clear} disabled={!dirty}>
              {t("viewer.signature.clear")}
            </Button>
            <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void importImage()} loading={importing}>
              {t("viewer.signature.fromImage")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
