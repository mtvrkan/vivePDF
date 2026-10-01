import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type LensShape, type PresentationTool } from "@/shared/store/presentationStore";
import {
  LASER_COLORS,
  LASER_SIZES,
  MAGNIFIER_SIZES,
  MAGNIFIER_ZOOMS,
  PEN_COLORS,
  PEN_WIDTHS,
  PRESENTATION_TOOLS,
  SPOTLIGHT_DIMS,
  SPOTLIGHT_SIZES,
  hasStyleOptions,
} from "./toolPresets";

export function PresentationToolButtons({ onSelect }: { onSelect?: (tool: PresentationTool) => void }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const setTool = usePresentationStore((state) => state.setTool);
  return (
    <>
      {PRESENTATION_TOOLS.map((entry) => (
        <IconButton
          key={entry.id}
          icon={entry.icon}
          label={t(entry.labelKey)}
          active={tool === entry.id}
          onClick={() => {
            const next = tool === entry.id ? "pointer" : entry.id;
            setTool(next);
            onSelect?.(next);
          }}
        />
      ))}
    </>
  );
}

export function PresentationStyleTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const laserColor = usePresentationStore((state) => state.laserColor);
  const isColorTool = tool === "pen" || tool === "highlighter" || tool === "laser";
  const Icon = PRESENTATION_TOOLS.find((entry) => entry.id === tool)?.icon;
  if (!hasStyleOptions(tool)) return <span className="inline-block size-8" aria-hidden />;
  return (
    <button
      type="button"
      aria-label={t("presentation.style")}
      title={t("presentation.style")}
      aria-pressed={open || undefined}
      onClick={onToggle}
      className={cn("nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80", open && "glass-chip text-primary")}
    >
      {isColorTool ? (
        <span className="size-4 rounded-full border border-border" style={{ backgroundColor: tool === "laser" ? laserColor : penColor }} />
      ) : Icon ? (
        <Icon className="size-4" aria-hidden />
      ) : null}
    </button>
  );
}

function ChipRow<T extends number>({
  label,
  values,
  current,
  format,
  onPick,
}: {
  label: string;
  values: readonly T[];
  current: T;
  format: (value: T) => string;
  onPick: (value: T) => void;
}) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            className={cn(
              "h-6 min-w-9 rounded-md px-1.5 font-mono text-[10px] tabular-nums",
              current === value ? "glass-chip text-primary" : "nav-glass text-muted-foreground",
            )}
          >
            {format(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ShapeRow({ current, onPick }: { current: LensShape; onPick: (shape: LensShape) => void }) {
  const { t } = useTranslation();
  const shapes: Array<{ id: LensShape; labelKey: string; className: string }> = [
    { id: "circle", labelKey: "presentation.shapeCircle", className: "rounded-full" },
    { id: "rect", labelKey: "presentation.shapeRect", className: "rounded-[3px]" },
  ];
  return (
    <div className="mt-2">
      <p className="mb-1 text-[11px] text-muted-foreground">{t("presentation.shape")}</p>
      <div className="flex items-center gap-1">
        {shapes.map((shape) => (
          <button
            key={shape.id}
            type="button"
            aria-label={t(shape.labelKey)}
            title={t(shape.labelKey)}
            onClick={() => onPick(shape.id)}
            className={cn("flex h-6 w-9 items-center justify-center rounded-md", current === shape.id ? "glass-chip" : "nav-glass")}
          >
            <span className={cn("size-3.5 border-2", current === shape.id ? "border-primary" : "border-muted-foreground", shape.className)} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorRow({ colors, current, onPick }: { colors: readonly string[]; current: string; onPick: (color: string) => void }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {colors.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onPick(preset)}
          aria-label={preset}
          className={cn(
            "size-5 rounded-full border transition-transform duration-(--transition-fast) hover:scale-110",
            current.toLowerCase() === preset.toLowerCase() ? "border-foreground ring-2 ring-ring/40" : "border-border",
          )}
          style={{ backgroundColor: preset }}
        />
      ))}
    </div>
  );
}

export function PresentationStyleControls() {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const setPenColor = usePresentationStore((state) => state.setPenColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const setPenWidth = usePresentationStore((state) => state.setPenWidth);
  const laserColor = usePresentationStore((state) => state.laserColor);
  const setLaserColor = usePresentationStore((state) => state.setLaserColor);
  const laserSize = usePresentationStore((state) => state.laserSize);
  const setLaserSize = usePresentationStore((state) => state.setLaserSize);
  const spotlightRadius = usePresentationStore((state) => state.spotlightRadius);
  const setSpotlightRadius = usePresentationStore((state) => state.setSpotlightRadius);
  const spotlightShape = usePresentationStore((state) => state.spotlightShape);
  const setSpotlightShape = usePresentationStore((state) => state.setSpotlightShape);
  const spotlightDim = usePresentationStore((state) => state.spotlightDim);
  const setSpotlightDim = usePresentationStore((state) => state.setSpotlightDim);
  const magnifierSize = usePresentationStore((state) => state.magnifierSize);
  const setMagnifierSize = usePresentationStore((state) => state.setMagnifierSize);
  const magnifierZoom = usePresentationStore((state) => state.magnifierZoom);
  const setMagnifierZoom = usePresentationStore((state) => state.setMagnifierZoom);
  const magnifierShape = usePresentationStore((state) => state.magnifierShape);
  const setMagnifierShape = usePresentationStore((state) => state.setMagnifierShape);

  const heading = PRESENTATION_TOOLS.find((entry) => entry.id === tool)?.labelKey ?? "presentation.style";

  return (
    <div className="w-56">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t(heading)}</p>
      {tool === "pen" || tool === "highlighter" ? (
        <>
          <ColorRow colors={PEN_COLORS} current={penColor} onPick={setPenColor} />
          <ChipRow label={t("presentation.size")} values={PEN_WIDTHS} current={penWidth} format={(value) => `${value}px`} onPick={setPenWidth} />
        </>
      ) : null}
      {tool === "laser" ? (
        <>
          <ColorRow colors={LASER_COLORS} current={laserColor} onPick={setLaserColor} />
          <ChipRow label={t("presentation.size")} values={LASER_SIZES} current={laserSize} format={(value) => `${value}px`} onPick={setLaserSize} />
        </>
      ) : null}
      {tool === "spotlight" ? (
        <>
          <ShapeRow current={spotlightShape} onPick={setSpotlightShape} />
          <ChipRow label={t("presentation.size")} values={SPOTLIGHT_SIZES} current={spotlightRadius} format={(value) => String(value)} onPick={setSpotlightRadius} />
          <ChipRow label={t("presentation.dim")} values={SPOTLIGHT_DIMS} current={spotlightDim} format={(value) => `${Math.round(value * 100)}%`} onPick={setSpotlightDim} />
        </>
      ) : null}
      {tool === "magnifier" ? (
        <>
          <ShapeRow current={magnifierShape} onPick={setMagnifierShape} />
          <ChipRow label={t("presentation.size")} values={MAGNIFIER_SIZES} current={magnifierSize} format={(value) => String(value)} onPick={setMagnifierSize} />
          <ChipRow label={t("presentation.zoom")} values={MAGNIFIER_ZOOMS} current={magnifierZoom} format={(value) => `${value}×`} onPick={setMagnifierZoom} />
        </>
      ) : null}
    </div>
  );
}
