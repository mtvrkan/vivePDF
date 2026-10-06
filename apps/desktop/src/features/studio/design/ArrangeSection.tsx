import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, FlipHorizontal2, FlipVertical2, Lock, LockOpen, PaintBucket, Paintbrush, StretchHorizontal, StretchVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import type { StudioElement, StudioPage } from "@/types/studio";
import { distributableCount } from "../model/edit";
import { align, distribute, flipSelection, patchSelected, toggleLock } from "./commands";
import { NumberField, OpacityField, PanelSection } from "./controls";
import { moveSelectionTo, resizeSelectionTo, selectionFrame, sharedValue } from "./multiEdit";
import { copyStyle, pasteStyle, useStyleClipboard } from "./styleClipboard";
import { currentPage, useStudioStore } from "./studioStore";
import { fromMm, toMm } from "./units";

export function ArrangeSection({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const single = elements.length === 1 ? elements[0] : null;
  const locked = elements.every((element) => element.locked);
  const opacity = sharedValue(elements.map((element) => element.opacity));
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
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" suffix="mm" value={toMm(single.x)} step={1} onChange={(value) => patchSelected({ x: fromMm(value) })} disabled={single.locked} />
          <NumberField label="Y" suffix="mm" value={toMm(single.y)} step={1} onChange={(value) => patchSelected({ y: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.width")} suffix="mm" value={toMm(single.width)} min={0.5} step={1} onChange={(value) => patchSelected({ width: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.height")} suffix="mm" value={toMm(single.height)} min={0.5} step={1} onChange={(value) => patchSelected({ height: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.rotation")} suffix="°" value={Math.round(single.rotation * 10) / 10} min={-360} max={360} onChange={(value) => patchSelected({ rotation: value })} disabled={single.locked} />
        </div>
      ) : (
        <GroupGeometry elements={elements} />
      )}
      <OpacityField label={t("studio.props.opacity")} value={opacity.value} mixed={opacity.mixed} onChange={(value, merge) => patchSelected({ opacity: value }, merge)} />
      <StyleClipboardButtons />
    </PanelSection>
  );
}

function GroupGeometry({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const frame = selectionFrame(elements);
  const rotation = sharedValue(elements.map((element) => Math.round(element.rotation * 10) / 10));
  if (!frame) return null;
  const locked = elements.some((element) => element.locked);
  const onPage = (change: (page: StudioPage, ids: string[]) => StudioPage) => {
    const state = useStudioStore.getState();
    state.applyToPage((page) => change(page, state.selection));
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="X" suffix="mm" value={toMm(frame.x)} step={1} disabled={locked} onChange={(value) => onPage((page, ids) => moveSelectionTo(page, ids, fromMm(value), frame.y))} />
      <NumberField label="Y" suffix="mm" value={toMm(frame.y)} step={1} disabled={locked} onChange={(value) => onPage((page, ids) => moveSelectionTo(page, ids, frame.x, fromMm(value)))} />
      <NumberField label={t("studio.props.width")} suffix="mm" value={toMm(frame.width)} min={0.5} step={1} disabled={locked} onChange={(value) => onPage((page, ids) => resizeSelectionTo(page, ids, fromMm(value), frame.height))} />
      <NumberField label={t("studio.props.height")} suffix="mm" value={toMm(frame.height)} min={0.5} step={1} disabled={locked} onChange={(value) => onPage((page, ids) => resizeSelectionTo(page, ids, frame.width, fromMm(value)))} />
      <NumberField label={t("studio.props.rotation")} suffix="°" value={rotation.value} mixed={rotation.mixed} min={-360} max={360} disabled={locked} onChange={(value) => patchSelected({ rotation: value })} />
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
