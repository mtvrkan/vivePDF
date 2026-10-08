import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, FlipHorizontal2, FlipVertical2, Link2, Lock, LockOpen, PaintBucket, Paintbrush, StretchHorizontal, StretchVertical, Unlink2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { IconButton } from "@/components/shared/IconButton";
import type { StudioElement, StudioPage } from "@/types/studio";
import { distributableCount } from "../model/edit";
import { align, distribute, flipSelection, patchSelected, toggleLock } from "./commands";
import { NumberField, OpacityField, PanelSection } from "./controls";
import { moveSelectionTo, resizeSelectionTo, selectionFrame, sharedValue, sizeElementTo } from "./multiEdit";
import { copyStyle, pasteStyle, useStyleClipboard } from "./styleClipboard";
import { currentPage, useStudioStore } from "./studioStore";
import { MIN_SIDE, normalizeAngle, ratioLocked } from "./transform";
import { fromMm, toMm } from "./units";

type Limits = { x: [number, number]; y: [number, number]; width: [number, number]; height: [number, number] };

function usePageLimits(): Limits {
  const [width, height] = useStudioStore(
    useShallow((state) => {
      const page = currentPage(state);
      return page ? [page.width, page.height] : [0, 0];
    }),
  );
  const side = (extent: number): [number, number] => [toMm(MIN_SIDE), toMm(Math.max(extent, MIN_SIDE) * 4)];
  return { x: [-toMm(width), toMm(width * 2)], y: [-toMm(height), toMm(height * 2)], width: side(width), height: side(height) };
}

const shownAngle = (degrees: number) => Math.round(normalizeAngle(degrees) * 10) / 10;

export function ArrangeSection({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const single = elements.length === 1 ? elements[0] : null;
  const locked = elements.every((element) => element.locked);
  const opacity = sharedValue(elements.map((element) => element.opacity));
  const limits = usePageLimits();
  const distributable = useStudioStore((state) => {
    const page = currentPage(state);
    return page ? distributableCount(page, state.selection) : 0;
  });
  const alignButtons = [
    { mode: "left", icon: AlignStartVertical },
    { mode: "centerX", icon: AlignCenterVertical },
    { mode: "right", icon: AlignEndVertical },
    { mode: "top", icon: AlignStartHorizontal },
    { mode: "middleY", icon: AlignCenterHorizontal },
    { mode: "bottom", icon: AlignEndHorizontal },
  ] as const;
  return (
    <PanelSection title={t("studio.props.arrange")}>
      <div className="flex flex-wrap items-center gap-1">
        {alignButtons.map(({ mode, icon }) => (
          <IconButton key={mode} icon={icon} label={t(`studio.align.${mode}`)} onClick={() => align(mode)} />
        ))}
        {distributable > 2 ? (
          <>
            <IconButton icon={StretchHorizontal} label={t("studio.align.distributeHorizontal")} onClick={() => distribute("horizontal")} />
            <IconButton icon={StretchVertical} label={t("studio.align.distributeVertical")} onClick={() => distribute("vertical")} />
          </>
        ) : null}
        <IconButton icon={locked ? Lock : LockOpen} active={locked} label={locked ? t("studio.props.unlock") : t("studio.props.lock")} onClick={toggleLock} />
        <IconButton icon={FlipHorizontal2} active={elements.every((element) => element.flipX)} disabled={locked} label={t("studio.flip.horizontal")} shortcut="Shift+H" onClick={() => flipSelection("horizontal")} />
        <IconButton icon={FlipVertical2} active={elements.every((element) => element.flipY)} disabled={locked} label={t("studio.flip.vertical")} shortcut="Shift+V" onClick={() => flipSelection("vertical")} />
      </div>
      {single ? (
        <SingleGeometry element={single} limits={limits} />
      ) : (
        <GroupGeometry elements={elements} limits={limits} />
      )}
      <OpacityField label={t("studio.props.opacity")} value={opacity.value} mixed={opacity.mixed} onChange={(value, merge) => patchSelected({ opacity: value }, merge)} />
      <StyleClipboardButtons />
    </PanelSection>
  );
}

function SingleGeometry({ element, limits }: { element: StudioElement; limits: Limits }) {
  const { t } = useTranslation();
  const disabled = element.locked;
  const resize = (size: { width?: number; height?: number }, merge?: string) => patchSelected((current) => sizeElementTo(current, size), merge);
  const ratio = ratioLocked(element);
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="X" suffix="mm" value={toMm(element.x)} step={1} min={limits.x[0]} max={limits.x[1]} mergeKey="x" onChange={(value, merge) => patchSelected({ x: fromMm(value) }, merge)} disabled={disabled} />
      <NumberField label="Y" suffix="mm" value={toMm(element.y)} step={1} min={limits.y[0]} max={limits.y[1]} mergeKey="y" onChange={(value, merge) => patchSelected({ y: fromMm(value) }, merge)} disabled={disabled} />
      <NumberField label={t("studio.props.width")} suffix="mm" value={toMm(element.width)} step={1} min={limits.width[0]} max={limits.width[1]} mergeKey="width" onChange={(value, merge) => resize({ width: fromMm(value) }, merge)} disabled={disabled} />
      <NumberField label={t("studio.props.height")} suffix="mm" value={toMm(element.height)} step={1} min={limits.height[0]} max={limits.height[1]} mergeKey="height" onChange={(value, merge) => resize({ height: fromMm(value) }, merge)} disabled={disabled || element.kind === "qr"} />
      <NumberField label={t("studio.props.rotation")} suffix="°" value={shownAngle(element.rotation)} min={-360} max={360} mergeKey="rotation" onChange={(value, merge) => patchSelected({ rotation: normalizeAngle(value) }, merge)} disabled={disabled} />
      {element.kind === "text" ? null : (
        <div className="flex items-end">
          <IconButton icon={ratio ? Link2 : Unlink2} active={ratio} disabled={disabled || element.kind === "qr"} label={ratio ? t("studio.props.unlockRatio") : t("studio.props.lockRatio")} onClick={() => patchSelected({ lockRatio: !ratio })} />
        </div>
      )}
    </div>
  );
}

function GroupGeometry({ elements, limits }: { elements: StudioElement[]; limits: Limits }) {
  const { t } = useTranslation();
  const frame = selectionFrame(elements);
  const rotation = sharedValue(elements.map((element) => shownAngle(element.rotation)));
  if (!frame) return null;
  const locked = elements.some((element) => element.locked);
  const onPage = (change: (page: StudioPage, ids: string[]) => StudioPage, merge?: string) => {
    const state = useStudioStore.getState();
    state.applyToPage((page) => change(page, state.selection), merge ? { merge } : undefined);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="X" suffix="mm" value={toMm(frame.x)} step={1} min={limits.x[0]} max={limits.x[1]} mergeKey="x" disabled={locked} onChange={(value, merge) => onPage((page, ids) => moveSelectionTo(page, ids, fromMm(value), frame.y), merge)} />
      <NumberField label="Y" suffix="mm" value={toMm(frame.y)} step={1} min={limits.y[0]} max={limits.y[1]} mergeKey="y" disabled={locked} onChange={(value, merge) => onPage((page, ids) => moveSelectionTo(page, ids, frame.x, fromMm(value)), merge)} />
      <NumberField label={t("studio.props.width")} suffix="mm" value={toMm(frame.width)} step={1} min={limits.width[0]} max={limits.width[1]} mergeKey="width" disabled={locked} onChange={(value, merge) => onPage((page, ids) => resizeSelectionTo(page, ids, fromMm(value), frame.height), merge)} />
      <NumberField label={t("studio.props.height")} suffix="mm" value={toMm(frame.height)} step={1} min={limits.height[0]} max={limits.height[1]} mergeKey="height" disabled={locked} onChange={(value, merge) => onPage((page, ids) => resizeSelectionTo(page, ids, frame.width, fromMm(value)), merge)} />
      <NumberField label={t("studio.props.rotation")} suffix="°" value={rotation.value} mixed={rotation.mixed} min={-360} max={360} mergeKey="rotation" disabled={locked} onChange={(value, merge) => patchSelected({ rotation: normalizeAngle(value) }, merge)} />
    </div>
  );
}

function StyleClipboardButtons() {
  const { t } = useTranslation();
  const hasStyle = useStyleClipboard((state) => state.style !== null);
  const chip = "glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chip} title={`${t("studio.style.copy")} (Ctrl+Alt+C)`} aria-keyshortcuts="Control+Alt+C" onClick={copyStyle}>
        <Paintbrush className="size-4" aria-hidden />
        {t("studio.style.copy")}
      </button>
      <button type="button" className={chip} title={`${t("studio.style.paste")} (Ctrl+Alt+V)`} aria-keyshortcuts="Control+Alt+V" disabled={!hasStyle} onClick={pasteStyle}>
        <PaintBucket className="size-4" aria-hidden />
        {t("studio.style.paste")}
      </button>
    </div>
  );
}
