import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Move3d } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { Segmented, SliderField, SwitchField } from "@/components/tool/form";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import { clampParams, initialParams, isRotatable, SHAPE_GROUPS, SHAPES, shapeById, type ShapeDefinition, type ShapeGroup, type ShapeParams } from "./catalog";
import { DEFAULT_SHAPE_STYLE, labelsOf, renderShape, shapeDataUrl, type ShapeStyle } from "./render";
import type { ShapeSource } from "./shapeObject";
import { useLabelArt } from "./useLabelArt";

export type ShapeDraft = { id: string; params: ShapeParams; style: ShapeStyle };

const DEFAULT_FILL = "#2563eb";
const DRAG_DEGREES_PER_PX = 0.6;
const thumbnails = new Map<string, string>();

function thumbnailOf(shape: ShapeDefinition): string {
  const cached = thumbnails.get(shape.id);
  if (cached) return cached;
  const url = shapeDataUrl(renderShape(shape.build(initialParams(shape)), { ...DEFAULT_SHAPE_STYLE, labels: false, weight: 1.8 }, new Map()).svg);
  thumbnails.set(shape.id, url);
  return url;
}

function wrapDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function ShapeGrid({ group, selected, onSelect }: { group: ShapeGroup; selected: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const shapes = SHAPES.filter((shape) => shape.group === group);
  const ids = shapes.map((shape) => shape.id);
  const roving = useRovingRadios(ids, Math.max(0, ids.indexOf(selected)), onSelect);
  return (
    <div role="radiogroup" aria-label={t(`viewer.shapes.groups.${group}`)} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {shapes.map((shape, index) => {
        const name = t(`viewer.shapes.names.${shape.id}`);
        const active = shape.id === selected;
        return (
          <button
            key={shape.id}
            ref={roving.refOf(index)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={roving.tabIndexOf(index)}
            onKeyDown={roving.onKeyDown}
            onClick={() => onSelect(shape.id)}
            title={name}
            className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition-[box-shadow] duration-(--transition-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/40")}
          >
            <span className="flex h-12 w-full items-center justify-center rounded-md bg-white p-1">
              <img src={thumbnailOf(shape)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </span>
            <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ShapeDialog({ initial, updating, onClose, onSubmit }: { initial: ShapeDraft; updating: boolean; onClose: () => void; onSubmit: (source: ShapeSource) => void }) {
  const { t } = useTranslation();
  const initialShape = shapeById(initial.id) ?? SHAPES[0];
  const [group, setGroup] = useState<ShapeGroup>(initialShape.group);
  const [shapeId, setShapeId] = useState(initialShape.id);
  const [params, setParams] = useState<ShapeParams>(clampParams(initialShape, initial.params));
  const [style, setStyle] = useState<ShapeStyle>(initial.style);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const shape = shapeById(shapeId) ?? SHAPES[0];
  const values = useMemo(() => clampParams(shape, params), [shape, params]);
  const primitives = useMemo(() => shape.build(values), [shape, values]);
  const latexList = useMemo(() => (style.labels ? labelsOf(primitives) : []), [primitives, style.labels]);

  const labelArt = useLabelArt(latexList);

  const rendered = renderShape(primitives, style, labelArt.labels);
  const labelsPending = style.labels && labelArt.status === "loading";

  const selectShape = (id: string) => {
    const next = shapeById(id);
    if (!next || id === shapeId) return;
    setShapeId(id);
    setParams(initialParams(next));
  };

  const setParam = (key: string, value: number | boolean) => setParams((current) => ({ ...clampParams(shape, current), [key]: value }));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isRotatable(shape)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, yaw: Number(values.yaw), pitch: Number(values.pitch) };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const yaw = wrapDegrees(start.yaw + (event.clientX - start.x) * DRAG_DEGREES_PER_PX);
    const pitch = Math.max(-90, Math.min(90, start.pitch + (event.clientY - start.y) * DRAG_DEGREES_PER_PX));
    setParams((current) => ({ ...clampParams(shape, current), yaw: Math.round(yaw), pitch: Math.round(pitch) }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const submit = async () => {
    setBusy(true);
    try {
      await labelArt.settle();
      const final = renderShape(primitives, style, labelArt.labels);
      onSubmit({ id: shape.id, params: values, style, svg: final.svg, width: final.width, height: final.height });
    } finally {
      setBusy(false);
    }
  };

  const paramLabel = (key: string) => t(`viewer.shapes.params.${key}`);

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.shapes.editTitle") : t("viewer.shapes.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy}>
            {updating ? t("viewer.shapes.update") : t("viewer.shapes.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented size="sm" value={group} options={SHAPE_GROUPS} labelOf={(value) => t(`viewer.shapes.groups.${value}`)} onChange={setGroup} ariaLabel={t("viewer.shapes.groupsLabel")} className="flex flex-wrap self-start" />
        <ShapeGrid group={group} selected={shapeId} onSelect={selectShape} />
        <div className="grid gap-4 md:grid-cols-5">
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <div
              role="img"
              aria-label={t(`viewer.shapes.names.${shape.id}`)}
              aria-busy={labelsPending}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn("paper-surface flex h-64 items-center justify-center rounded-xl border bg-white p-4", isRotatable(shape) && "cursor-grab touch-none active:cursor-grabbing")}
            >
              <img src={shapeDataUrl(rendered.svg)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isRotatable(shape) ? (
                <>
                  <Move3d className="size-3.5" aria-hidden />
                  {t("viewer.shapes.dragHint")}
                </>
              ) : null}
              {labelArt.status === "failed" && style.labels ? <span className="text-destructive">{t("viewer.shapes.labelsFailed")}</span> : null}
            </p>
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            {shape.params.map((param) =>
              param.kind === "range" ? (
                <SliderField key={param.key} label={paramLabel(param.key)} value={Number(values[param.key])} min={param.min} max={param.max} step={param.step} onChange={(value) => setParam(param.key, value)} format={(value) => `${value}${param.unit ?? ""}`} />
              ) : (
                <SwitchField key={param.key} label={paramLabel(param.key)} checked={Boolean(values[param.key])} onChange={(value) => setParam(param.key, value)} />
              ),
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground/80">{t("viewer.shapes.stroke")}</span>
              <ColorSwatch value={style.stroke} onChange={(stroke) => setStyle((current) => ({ ...current, stroke }))} label={t("viewer.shapes.stroke")} customLabel={t("viewer.overlay.customColor")} />
            </div>
            <SwitchField label={t("viewer.shapes.fill")} checked={style.fill !== null} onChange={(on) => setStyle((current) => ({ ...current, fill: on ? DEFAULT_FILL : null }))} />
            {style.fill !== null ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-foreground/80">{t("viewer.shapes.fillColor")}</span>
                <ColorSwatch value={style.fill} onChange={(fill) => setStyle((current) => ({ ...current, fill }))} label={t("viewer.shapes.fillColor")} customLabel={t("viewer.overlay.customColor")} />
              </div>
            ) : null}
            <SliderField label={t("viewer.shapes.weight")} value={style.weight} min={0.4} max={4} step={0.1} onChange={(weight) => setStyle((current) => ({ ...current, weight }))} format={(value) => `${value.toFixed(1)} pt`} />
            <SwitchField label={t("viewer.shapes.labels")} checked={style.labels} onChange={(labels) => setStyle((current) => ({ ...current, labels }))} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
