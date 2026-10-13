import { useId, useState } from "react";
import { ImageDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import { basenameOf } from "@/shared/lib/paths";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { DrawingImageFormat } from "@/types";
import { copyDrawingImage, DEFAULT_DRAWING_SCALE, DRAWING_IMAGE_FORMATS, DRAWING_IMAGE_SCALES, drawingPixelSize, saveDrawingImage, type DrawingImageScale } from "./drawingImageExport";
import type { DrawingImage } from "./drawingSource";

const CHOICE_CLASS = "rounded-md border px-2.5 py-1 text-sm transition-[box-shadow] duration-(--transition-fast) hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Choices<T extends string | number>({ label, options, value, onChange, text }: { label: string; options: readonly T[]; value: T; onChange: (option: T) => void; text: (option: T) => string }) {
  const roving = useRovingRadios(options, Math.max(0, options.indexOf(value)), onChange);
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 p-0.5">
      {options.map((option, index) => (
        <button
          key={option}
          ref={roving.refOf(index)}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={roving.tabIndexOf(index)}
          onKeyDown={roving.onKeyDown}
          onClick={() => onChange(option)}
          className={cn(CHOICE_CLASS, option === value ? "font-medium text-foreground ring-2 ring-primary" : "text-muted-foreground")}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );
}

export function DrawingImageButton({ item, documentPath }: { item: DrawingImage; documentPath: string | null }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<DrawingImageFormat>("png");
  const [scale, setScale] = useState<DrawingImageScale>(DEFAULT_DRAWING_SCALE);
  const [busy, setBusy] = useState<"save" | "copy" | null>(null);
  const titleId = useId();
  const pixels = drawingPixelSize(item.width, item.height, scale);

  const save = async () => {
    setBusy("save");
    try {
      const output = await saveDrawingImage({ item, format, scale, documentPath, t });
      if (output) {
        toast("success", t("viewer.context.imageSaved", { name: basenameOf(output) }));
        setOpen(false);
      }
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy("copy");
    try {
      await copyDrawingImage(item, scale);
      toast("success", t("viewer.context.imageCopied"));
      setOpen(false);
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="relative">
      <IconButton icon={ImageDown} label={t("viewer.drawingImage.menu")} active={open} onClick={() => setOpen((current) => !current)} />
      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="glass-menu absolute start-0 top-9 z-50 flex w-72 flex-col gap-2 rounded-lg p-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <p id={titleId} className="text-sm font-medium text-foreground/80">
            {t("viewer.drawingImage.title")}
          </p>
          <Choices label={t("viewer.drawingImage.format")} options={DRAWING_IMAGE_FORMATS} value={format} onChange={setFormat} text={(option) => t(`viewer.drawingImage.formats.${option}`)} />
          {format === "png" ? (
            <>
              <Choices label={t("viewer.drawingImage.scale")} options={DRAWING_IMAGE_SCALES} value={scale} onChange={setScale} text={(option) => t("viewer.drawingImage.scaleOption", { scale: option })} />
              <p className="text-xs text-muted-foreground tabular-nums">{t("viewer.drawingImage.pixels", { width: pixels.width, height: pixels.height })}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("viewer.drawingImage.vectorHint")}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" loading={busy === "copy"} disabled={busy !== null} onClick={() => void copy()}>
              {t("viewer.drawingImage.copy")}
            </Button>
            <Button size="sm" variant="primary" loading={busy === "save"} disabled={busy !== null} onClick={() => void save()}>
              {t("viewer.drawingImage.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
