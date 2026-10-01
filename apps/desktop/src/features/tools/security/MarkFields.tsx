import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Field, SelectInput, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { PositionGrid } from "@/components/tool/PositionGrid";
import type { PageSide, WatermarkPosition } from "@/types";

const PAGE_SIDES: PageSide[] = ["all", "odd", "even"];
const percent = (value: number) => value + "%";
const degrees = (value: number) => value + "\u00b0";

export function MarkFields({
  opacity,
  onOpacity,
  opacityMin,
  rotation,
  onRotation,
  rotationLimit,
  position,
  onPosition,
  tile = false,
  tileGap,
  onTileGap,
  offsetX,
  onOffsetX,
  offsetY,
  onOffsetY,
  behind,
  onBehind,
  pages,
  onPages,
  side,
  onSide,
  children,
}: {
  opacity: number;
  onOpacity: (value: number) => void;
  opacityMin: number;
  rotation: number;
  onRotation: (value: number) => void;
  rotationLimit: number;
  position: WatermarkPosition;
  onPosition: (value: WatermarkPosition) => void;
  tile?: boolean;
  tileGap?: number;
  onTileGap?: (value: number) => void;
  offsetX: number;
  onOffsetX: (value: number) => void;
  offsetY: number;
  onOffsetY: (value: number) => void;
  behind: boolean;
  onBehind: (value: boolean) => void;
  pages: string;
  onPages: (value: string) => void;
  side: PageSide;
  onSide: (value: PageSide) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SliderField label={t("tools.mark.opacity")} value={opacity} min={opacityMin} max={100} onChange={onOpacity} format={percent} />
        <SliderField label={t("tools.mark.rotation")} value={rotation} min={-rotationLimit} max={rotationLimit} onChange={onRotation} format={degrees} />
      </div>
      {children}
      <div className="flex flex-wrap items-start gap-5">
        <PositionGrid value={position} onChange={onPosition} label={t("tools.position")} tile={tile} />
        <div className="min-w-56 flex-1 space-y-3.5">
          {position === "tile" && tileGap !== undefined && onTileGap ? (
            <SliderField label={t("tools.mark.tileGap")} value={tileGap} min={40} max={400} step={10} onChange={onTileGap} format={percent} />
          ) : null}
          <SliderField label={t("tools.mark.offsetX")} value={offsetX} min={-50} max={50} onChange={onOffsetX} format={percent} />
          <SliderField label={t("tools.mark.offsetY")} value={offsetY} min={-50} max={50} onChange={onOffsetY} format={percent} />
        </div>
      </div>
      <SwitchField label={t("tools.mark.behind")} hint={t("tools.mark.behindHint")} checked={behind} onChange={onBehind} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={pages} onChange={(event) => onPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
        <Field label={t("tools.side")}>
          <SelectInput value={side} aria-label={t("tools.side")} onChange={(event) => onSide(event.target.value as PageSide)}>
            {PAGE_SIDES.map((value) => (
              <option key={value} value={value}>
                {t(`tools.sides.${value}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </>
  );
}
