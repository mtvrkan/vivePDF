import { AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignJustify, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, Bold, Italic, Lock, LockOpen, StretchHorizontal, StretchVertical, Underline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Segmented, SliderField, SwitchField, TextArea } from "@/components/tool/form";
import type { StudioElement, StudioImageElement, StudioPage, StudioQrElement, StudioShapeElement, StudioTextAlign, StudioTextElement, StudioVerticalAlign } from "@/types/studio";
import { STUDIO_PAGE_SIZES, type StudioPageSize } from "../model/design";
import { align, distribute, patchSelected, toggleLock } from "./commands";
import { ColorField, FillEditor, NumberField, PanelSection, StrokeEditor } from "./controls";
import { pickImage } from "./pickImage";
import { fromMm, toMm } from "./units";
import { DEFAULT_FONT_ID } from "./fonts";
import { withElementStyle, type StylePatch } from "./richText";
import { textEditorBridge } from "./textEditorBridge";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";

const TEXT_ALIGNS: StudioTextAlign[] = ["left", "center", "right", "justify"];
const VERTICAL_ALIGNS: StudioVerticalAlign[] = ["top", "middle", "bottom"];
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;

function sizeKeyOf(page: StudioPage): StudioPageSize | "custom" {
  const match = (Object.keys(STUDIO_PAGE_SIZES) as StudioPageSize[]).find((key) => Math.abs(STUDIO_PAGE_SIZES[key].width - page.width) < 0.5 && Math.abs(STUDIO_PAGE_SIZES[key].height - page.height) < 0.5);
  return match ?? "custom";
}

function PageProperties({ page }: { page: StudioPage }) {
  const { t } = useTranslation();
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const setPage = (patch: Partial<StudioPage>, merge?: string) => applyToPage((current) => ({ ...current, ...patch }), merge ? { merge } : undefined);
  const sizeKey = sizeKeyOf(page);
  const image = page.background.image;
  return (
    <>
      <PanelSection title={t("studio.page.size")}>
        <Select
          value={sizeKey}
          ariaLabel={t("studio.page.size")}
          options={[...Object.keys(STUDIO_PAGE_SIZES).map((key) => ({ value: key, label: t(`studio.sizes.${key}`) })), { value: "custom", label: t("studio.sizes.custom"), disabled: true }]}
          onChange={(key) => {
            const size = STUDIO_PAGE_SIZES[key as StudioPageSize];
            if (size) setPage({ width: size.width, height: size.height });
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t("studio.page.width")} suffix="mm" value={toMm(page.width)} min={6.4} max={5080} step={1} onChange={(value) => setPage({ width: fromMm(value) })} />
          <NumberField label={t("studio.page.height")} suffix="mm" value={toMm(page.height)} min={6.4} max={5080} step={1} onChange={(value) => setPage({ height: fromMm(value) })} />
        </div>
      </PanelSection>
      <PanelSection title={t("studio.page.background")}>
        <FillEditor value={page.background.fill} onChange={(fill, merge) => setPage({ background: { ...page.background, fill } }, merge)} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="glass-chip h-8 rounded-lg px-3 text-sm font-medium"
            onClick={async () => {
              const src = await pickImage(t("studio.page.backgroundImage"));
              if (src) setPage({ background: { ...page.background, image: { src, fit: "cover", opacity: 1 } } });
            }}
          >
            {image ? t("studio.page.replaceImage") : t("studio.page.backgroundImage")}
          </button>
          {image ? (
            <button type="button" className="h-8 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => setPage({ background: { ...page.background, image: null } })}>
              {t("studio.page.removeImage")}
            </button>
          ) : null}
        </div>
        {image ? (
          <SliderField label={t("studio.props.opacity")} value={Math.round(image.opacity * 100)} min={0} max={100} format={(value) => `${value}%`} onChange={(value) => setPage({ background: { ...page.background, image: { ...image, opacity: value / 100 } } }, "bg-opacity")} />
        ) : null}
      </PanelSection>
    </>
  );
}

function ArrangeSection({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const single = elements.length === 1 ? elements[0] : null;
  const locked = elements.every((element) => element.locked);
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
        {elements.length > 2 ? (
          <>
            <IconButton icon={StretchHorizontal} label={t("studio.align.distributeHorizontal")} onClick={() => distribute("horizontal")} />
            <IconButton icon={StretchVertical} label={t("studio.align.distributeVertical")} onClick={() => distribute("vertical")} />
          </>
        ) : null}
        <IconButton icon={locked ? Lock : LockOpen} active={locked} label={locked ? t("studio.props.unlock") : t("studio.props.lock")} onClick={toggleLock} />
      </div>
      {single ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" suffix="mm" value={toMm(single.x)} step={1} onChange={(value) => patchSelected({ x: fromMm(value) })} disabled={single.locked} />
          <NumberField label="Y" suffix="mm" value={toMm(single.y)} step={1} onChange={(value) => patchSelected({ y: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.width")} suffix="mm" value={toMm(single.width)} min={0.5} step={1} onChange={(value) => patchSelected({ width: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.height")} suffix="mm" value={toMm(single.height)} min={0.5} step={1} onChange={(value) => patchSelected({ height: fromMm(value) })} disabled={single.locked} />
          <NumberField label={t("studio.props.rotation")} suffix="°" value={Math.round(single.rotation * 10) / 10} min={-360} max={360} onChange={(value) => patchSelected({ rotation: value })} disabled={single.locked} />
        </div>
      ) : null}
      <SliderField
        label={t("studio.props.opacity")}
        value={Math.round((single?.opacity ?? elements[0].opacity) * 100)}
        min={0}
        max={100}
        format={(value) => `${value}%`}
        onChange={(value) => patchSelected({ opacity: value / 100 }, "opacity")}
      />
    </PanelSection>
  );
}

function styleToggle(elements: StudioTextElement[], key: "bold" | "italic" | "underline") {
  const editing = textEditorBridge.current;
  if (editing) {
    const summary = editing.summary();
    const current = summary ? summary[key] : elements[0][key];
    editing.applyStyle({ [key]: !current });
    return;
  }
  const next = !elements.every((element) => element[key]);
  patchSelected((element) => (element.kind === "text" ? withElementStyle(element, { [key]: next }) : {}));
}

function applyTextStyle(patch: StylePatch) {
  const editing = textEditorBridge.current;
  if (editing) editing.applyStyle(patch);
  else patchSelected((element) => (element.kind === "text" ? withElementStyle(element, patch) : {}));
}

function TextSection({ elements }: { elements: StudioTextElement[] }) {
  const { t } = useTranslation();
  const first = elements[0];
  const patchText = (patch: Partial<StudioTextElement>, merge?: string) => patchSelected((element) => (element.kind === "text" ? patch : {}), merge);
  const keep = (event: React.MouseEvent) => event.preventDefault();
  return (
    <PanelSection title={t("studio.props.text")}>
      <FontPicker value={first.fontId ?? DEFAULT_FONT_ID} onChange={(fontId) => patchText({ fontId })} />
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <NumberField label={t("studio.props.fontSize")} suffix="pt" value={Math.round(first.fontSize * 10) / 10} min={1} max={1000} onChange={(fontSize) => patchText({ fontSize })} />
        <div className="flex gap-1" onMouseDown={keep}>
          <IconButton icon={Bold} label={t("studio.props.bold")} shortcut="Ctrl+B" active={first.bold} onClick={() => styleToggle(elements, "bold")} />
          <IconButton icon={Italic} label={t("studio.props.italic")} shortcut="Ctrl+I" active={first.italic} onClick={() => styleToggle(elements, "italic")} />
          <IconButton icon={Underline} label={t("studio.props.underline")} shortcut="Ctrl+U" active={first.underline} onClick={() => styleToggle(elements, "underline")} />
        </div>
      </div>
      <ColorField label={t("studio.props.color")} value={first.color} onChange={(color) => applyTextStyle({ color })} />
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("studio.props.align")}>
        {TEXT_ALIGNS.map((value) => (
          <IconButton key={value} icon={ALIGN_ICONS[value]} active={first.align === value} label={t(`studio.textAlign.${value}`)} onClick={() => patchText({ align: value })} />
        ))}
      </div>
      <Segmented size="sm" value={first.verticalAlign} options={VERTICAL_ALIGNS} labelOf={(value) => t(`studio.verticalAlign.${value}`)} onChange={(verticalAlign) => patchText({ verticalAlign })} ariaLabel={t("studio.props.verticalAlign")} />
      <SliderField label={t("studio.props.lineHeight")} value={first.lineHeight} min={0.6} max={3} step={0.05} format={(value) => value.toFixed(2)} onChange={(lineHeight) => patchText({ lineHeight }, "line-height")} />
      <SliderField label={t("studio.props.letterSpacing")} value={Math.round(first.letterSpacing * 1000)} min={-100} max={800} step={10} format={(value) => `${value}`} onChange={(value) => patchText({ letterSpacing: value / 1000 }, "letter-spacing")} />
      <SwitchField label={t("studio.props.uppercase")} checked={first.uppercase} onChange={(uppercase) => patchText({ uppercase })} />
      <SwitchField label={t("studio.props.shrinkToFit")} hint={t("studio.props.shrinkHint")} checked={first.shrinkToFit} onChange={(shrinkToFit) => patchText({ shrinkToFit })} />
    </PanelSection>
  );
}

function ShapeSection({ element }: { element: StudioShapeElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioShapeElement>, merge?: string) => patchSelected((item) => (item.kind === "shape" ? patch : {}), merge);
  const lineLike = element.shape === "line" || element.shape === "arrowLine";
  return (
    <>
      {lineLike ? null : (
        <PanelSection title={t("studio.props.fill")}>
          <FillEditor value={element.fill} onChange={(fill, merge) => set({ fill }, merge)} />
        </PanelSection>
      )}
      <PanelSection title={t("studio.props.stroke")}>
        <StrokeEditor value={element.stroke} onChange={(stroke, merge) => set({ stroke }, merge)} />
        {element.shape === "rect" || element.shape === "speech" ? (
          <SliderField label={t("studio.props.cornerRadius")} value={element.cornerRadius} min={0} max={Math.round(Math.min(element.width, element.height) / 2)} onChange={(cornerRadius) => set({ cornerRadius }, "radius")} />
        ) : null}
        {element.shape === "star" || element.shape === "burst" ? (
          <>
            <SliderField label={t("studio.props.points")} value={element.points} min={3} max={48} onChange={(points) => set({ points }, "points")} />
            <SliderField label={t("studio.props.innerRatio")} value={Math.round(element.innerRatio * 100)} min={10} max={95} format={(value) => `${value}%`} onChange={(value) => set({ innerRatio: value / 100 }, "inner")} />
          </>
        ) : null}
      </PanelSection>
    </>
  );
}

function ImageSection({ element }: { element: StudioImageElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioImageElement>, merge?: string) => patchSelected((item) => (item.kind === "image" ? patch : {}), merge);
  const crop = element.crop;
  const setCrop = (side: "left" | "top" | "right" | "bottom", percent: number) => {
    const value = percent / 100;
    const left = side === "left" ? value : crop.x;
    const top = side === "top" ? value : crop.y;
    const right = side === "right" ? value : 1 - crop.x - crop.width;
    const bottom = side === "bottom" ? value : 1 - crop.y - crop.height;
    if (left + right > 0.95 || top + bottom > 0.95) return;
    set({ crop: { x: left, y: top, width: 1 - left - right, height: 1 - top - bottom } }, `crop-${side}`);
  };
  return (
    <PanelSection title={t("studio.props.image")}>
      <button
        type="button"
        className="glass-chip h-8 rounded-lg px-3 text-sm font-medium"
        onClick={async () => {
          const src = await pickImage(t("studio.props.replaceImage"));
          if (src) set({ src });
        }}
      >
        {t("studio.props.replaceImage")}
      </button>
      <Segmented size="sm" value={element.fit} options={["cover", "contain", "stretch"] as const} labelOf={(fit) => t(`studio.fit.${fit}`)} onChange={(fit) => set({ fit })} ariaLabel={t("studio.fit.label")} />
      <Segmented size="sm" value={element.mask} options={["none", "rounded", "circle"] as const} labelOf={(mask) => t(`studio.mask.${mask}`)} onChange={(mask) => set({ mask })} ariaLabel={t("studio.mask.label")} />
      {element.mask === "rounded" ? (
        <SliderField label={t("studio.props.cornerRadius")} value={element.cornerRadius} min={0} max={Math.round(Math.min(element.width, element.height) / 2)} onChange={(cornerRadius) => set({ cornerRadius }, "radius")} />
      ) : null}
      <div className="grid grid-cols-2 gap-x-3">
        <SliderField label={t("studio.crop.left")} value={Math.round(crop.x * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("left", value)} />
        <SliderField label={t("studio.crop.right")} value={Math.round((1 - crop.x - crop.width) * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("right", value)} />
        <SliderField label={t("studio.crop.top")} value={Math.round(crop.y * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("top", value)} />
        <SliderField label={t("studio.crop.bottom")} value={Math.round((1 - crop.y - crop.height) * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("bottom", value)} />
      </div>
      <StrokeEditor value={element.stroke} onChange={(stroke, merge) => set({ stroke }, merge)} />
    </PanelSection>
  );
}

function QrSection({ element }: { element: StudioQrElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioQrElement>, merge?: string) => patchSelected((item) => (item.kind === "qr" ? patch : {}), merge);
  return (
    <PanelSection title={t("studio.props.qr")}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.props.qrValue")}</span>
        <TextArea rows={3} value={element.value} maxLength={2000} onChange={(event) => set({ value: event.target.value }, "qr-value")} />
      </label>
      <ColorField label={t("studio.props.color")} value={element.color} onChange={(color) => set({ color })} />
      <SwitchField label={t("studio.props.qrBackground")} checked={element.background !== null} onChange={(on) => set({ background: on ? "#ffffff" : null })} />
      {element.background ? <ColorField label={t("studio.props.background")} value={element.background} onChange={(background) => set({ background })} /> : null}
      <Segmented size="sm" value={element.errorLevel} options={["L", "M", "Q", "H"] as const} labelOf={(level) => level} onChange={(errorLevel) => set({ errorLevel })} ariaLabel={t("studio.props.qrLevel")} />
    </PanelSection>
  );
}

export function PropertiesPanel() {
  const { t } = useTranslation();
  const page = useStudioStore((state) => currentPage(state));
  const elements = useStudioStore(useShallow((state) => selectedElements(state)));
  if (!page) return null;
  const kinds = new Set(elements.map((element) => element.kind));
  const texts = elements.filter((element): element is StudioTextElement => element.kind === "text");
  const single = elements.length === 1 ? elements[0] : null;
  return (
    <aside aria-label={t("studio.props.label")} className="glass flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/60" data-testid="studio-properties">
      {elements.length === 0 ? <PageProperties page={page} /> : <ArrangeSection elements={elements} />}
      {texts.length && kinds.size === 1 ? <TextSection elements={texts} /> : null}
      {single?.kind === "shape" ? <ShapeSection element={single} /> : null}
      {single?.kind === "image" ? <ImageSection element={single} /> : null}
      {single?.kind === "qr" ? <QrSection element={single} /> : null}
    </aside>
  );
}

