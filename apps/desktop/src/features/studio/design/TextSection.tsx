import { useEffect, useMemo, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Strikethrough, Underline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Segmented, SliderField, SwitchField } from "@/components/tool/form";
import {
  STUDIO_LIST_KINDS,
  STUDIO_TEXT_AUTO_SIZES,
  STUDIO_TEXT_CASES,
  type StudioListKind,
  type StudioParagraph,
  type StudioTextAlign,
  type StudioTextAutoSize,
  type StudioTextCase,
  type StudioTextElement,
  type StudioVerticalAlign,
} from "@/types/studio";
import { MAX_RUN_SCALE, MIN_RUN_SCALE } from "../model/design";
import { fitParagraphs, paragraphCount, weightOf } from "../model/typography";
import { patchSelected } from "./commands";
import { ColorField, NumberField, PanelSection } from "./controls";
import { hasExtraWeights, nearestWeight, useFontWeights } from "./fontWeights";
import { boldPatch, runStyle, shiftLevel, toggleList, updateParagraphs, weightPatch, withElementStyle, type RunStyle, type StylePatch } from "./richText";
import { textEditorBridge, type ParagraphChange } from "./textEditorBridge";
import { useTextPrefsStore } from "./textPrefs";
import { useStudioStore } from "./studioStore";

const TEXT_ALIGNS: StudioTextAlign[] = ["left", "center", "right", "justify"];
const VERTICAL_ALIGNS: StudioVerticalAlign[] = ["top", "middle", "bottom"];
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
const TEXT_LANGUAGES = ["ar", "az", "de", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr", "uk", "zh"];
const MIN_SIZE = 1;
const MAX_SIZE = 1000;
const DEFAULT_OUTLINE = { color: "#000000", width: 1 };
const DEFAULT_SHADOW = { color: "#000000", x: 2, y: 2, opacity: 0.35 };
const DEFAULT_HIGHLIGHT = { color: "#fde047", padding: 2 };

type Flag = "bold" | "italic" | "underline" | "strike";
type Live = { style: RunStyle | null; paragraphs: StudioParagraph[] };

function useLiveSelection(editing: boolean): Live | null {
  const [live, setLive] = useState<Live | null>(null);
  const element = useStudioStore((state) => state.editingId);
  useEffect(() => {
    if (!editing) {
      setLive(null);
      return;
    }
    const read = () => {
      const bridge = textEditorBridge.current;
      setLive(bridge ? { style: bridge.summary(), paragraphs: bridge.selectedParagraphs() } : null);
    };
    read();
    document.addEventListener("selectionchange", read);
    const unsubscribe = useStudioStore.subscribe(read);
    return () => {
      document.removeEventListener("selectionchange", read);
      unsubscribe();
    };
  }, [editing, element]);
  return live;
}

function allParagraphs(element: StudioTextElement): StudioParagraph[] {
  return fitParagraphs(element.paragraphs, paragraphCount(element.runs));
}

export function TextSection({ elements }: { elements: StudioTextElement[] }) {
  const { t, i18n } = useTranslation();
  const first = elements[0];
  const editingId = useStudioStore((state) => state.editingId);
  const editing = elements.length === 1 && editingId === first.id;
  const live = useLiveSelection(editing);
  const base = runStyle(first, { text: "" });
  const style = live?.style ?? base;
  const weights = useFontWeights(style.fontId);
  const spellCheck = useTextPrefsStore((state) => state.spellCheck);
  const setSpellCheck = useTextPrefsStore((state) => state.setSpellCheck);
  const paragraphs = editing && live ? live.paragraphs : allParagraphs(first);
  const listKind = paragraphs[0]?.list ?? "none";
  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: "language" });
    } catch {
      return null;
    }
  }, [i18n.language]);

  const bridge = () => (editing ? textEditorBridge.current : null);
  const change = (update: (element: StudioTextElement) => Partial<StudioTextElement>, merge?: string) => {
    const editor = bridge();
    if (editor) editor.update((element) => ({ ...element, ...update(element) }));
    else patchSelected((element) => (element.kind === "text" ? update(element) : {}), merge);
  };
  const applyStyle = (patch: StylePatch) => {
    const editor = bridge();
    if (editor) editor.applyStyle(patch);
    else patchSelected((element) => (element.kind === "text" ? withElementStyle(element, patch) : {}));
  };
  const toggle = (key: Flag) => {
    const current = live?.style ? live.style[key] : elements.every((element) => element[key]);
    applyStyle(key === "bold" ? boldPatch(!current) : { [key]: !current });
  };
  const applyParagraphs = (build: ParagraphChange) => {
    const editor = bridge();
    if (editor) editor.applyParagraphs(build);
    else patchSelected((element) => (element.kind === "text" ? { paragraphs: updateParagraphs(element, null, build(allParagraphs(element))) } : {}));
  };
  const setSize = (size: number) => {
    if (live?.style) {
      applyStyle({ scale: Math.min(MAX_RUN_SCALE, Math.max(MIN_RUN_SCALE, size / first.fontSize)) });
      return;
    }
    change((element) => ({ ...withElementStyle(element, { scale: 1 }), fontSize: size }));
  };
  const setListKind = (kind: StudioListKind) => applyParagraphs(() => (paragraph) => ({ list: kind, level: kind === "none" ? 0 : paragraph.level }));
  const keep = (event: React.MouseEvent) => event.preventDefault();

  const weight = weightOf(style.bold, style.weight);
  const shownSize = Math.round(style.scale * first.fontSize * 10) / 10;
  const listed = paragraphs.some((paragraph) => paragraph.list !== "none");
  const allOf = (kinds: StudioListKind[]) => paragraphs.length > 0 && paragraphs.every((paragraph) => kinds.includes(paragraph.list));
  const languageLabel = (code: string) => languageNames?.of(code) ?? code;

  return (
    <>
      <PanelSection title={t("studio.props.text")}>
        <FontPicker value={style.fontId} onChange={(fontId) => applyStyle({ fontId })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t("studio.props.fontSize")} suffix="pt" value={shownSize} min={MIN_SIZE} max={MAX_SIZE} onChange={setSize} />
          {hasExtraWeights(weights) ? (
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.text.weight")}</span>
              <Select
                size="sm"
                value={String(nearestWeight(weights, weight))}
                ariaLabel={t("studio.text.weight")}
                options={weights.map((value) => ({ value: String(value), label: t(`studio.text.weights.${value}`, { defaultValue: String(value) }) }))}
                onChange={(value) => applyStyle(weightPatch(Number(value)))}
              />
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1" onMouseDown={keep}>
          <IconButton icon={Bold} label={t("studio.props.bold")} shortcut="Ctrl+B" active={weight >= 600} onClick={() => toggle("bold")} />
          <IconButton icon={Italic} label={t("studio.props.italic")} shortcut="Ctrl+I" active={style.italic} onClick={() => toggle("italic")} />
          <IconButton icon={Underline} label={t("studio.props.underline")} shortcut="Ctrl+U" active={style.underline} onClick={() => toggle("underline")} />
          <IconButton icon={Strikethrough} label={t("studio.text.strike")} shortcut="Ctrl+Shift+X" active={style.strike} onClick={() => toggle("strike")} />
        </div>
        <ColorField label={t("studio.props.color")} value={style.color} onChange={(color) => applyStyle({ color })} />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("studio.props.align")} onMouseDown={keep}>
          {TEXT_ALIGNS.map((value) => (
            <IconButton key={value} icon={ALIGN_ICONS[value]} active={first.align === value} label={t(`studio.textAlign.${value}`)} onClick={() => change(() => ({ align: value }))} />
          ))}
        </div>
        <Segmented size="sm" value={first.verticalAlign} options={VERTICAL_ALIGNS} labelOf={(value) => t(`studio.verticalAlign.${value}`)} onChange={(verticalAlign) => change(() => ({ verticalAlign }))} ariaLabel={t("studio.props.verticalAlign")} />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("studio.text.lists")} onMouseDown={keep}>
            <IconButton icon={List} label={t("studio.text.bulleted")} shortcut="Ctrl+Shift+8" active={allOf(["bullet", "dash", "check"])} onClick={() => applyParagraphs((selected) => toggleList(selected, "bullet"))} />
            <IconButton icon={ListOrdered} label={t("studio.text.numbered")} shortcut="Ctrl+Shift+7" active={allOf(["decimal", "alpha", "roman"])} onClick={() => applyParagraphs((selected) => toggleList(selected, "decimal"))} />
            <IconButton icon={IndentDecrease} label={t("studio.text.outdent")} shortcut="Shift+Tab" disabled={!listed} onClick={() => applyParagraphs(() => shiftLevel(-1))} />
            <IconButton icon={IndentIncrease} label={t("studio.text.indent")} shortcut="Tab" disabled={!listed} onClick={() => applyParagraphs(() => shiftLevel(1))} />
          </div>
          <Select size="sm" value={listKind} ariaLabel={t("studio.text.listStyle")} options={STUDIO_LIST_KINDS.map((kind) => ({ value: kind, label: t(`studio.text.listKinds.${kind}`) }))} onChange={(kind) => setListKind(kind as StudioListKind)} />
        </div>
        <SliderField label={t("studio.props.lineHeight")} value={first.lineHeight} min={0.6} max={3} step={0.05} format={(value) => value.toFixed(2)} onChange={(lineHeight) => change(() => ({ lineHeight }), "line-height")} />
        <SliderField label={t("studio.props.letterSpacing")} value={Math.round(first.letterSpacing * 1000)} min={-100} max={800} step={10} format={(value) => `${value}`} onChange={(value) => change(() => ({ letterSpacing: value / 1000 }), "letter-spacing")} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.text.case")}</span>
            <Select size="sm" value={first.textCase} ariaLabel={t("studio.text.case")} options={STUDIO_TEXT_CASES.map((value) => ({ value, label: t(`studio.text.cases.${value}`) }))} onChange={(value) => change(() => ({ textCase: value as StudioTextCase }))} />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.text.autoSize")}</span>
            <Select size="sm" value={first.autoSize} ariaLabel={t("studio.text.autoSize")} options={STUDIO_TEXT_AUTO_SIZES.map((value) => ({ value, label: t(`studio.text.autoSizes.${value}`) }))} onChange={(value) => change(() => ({ autoSize: value as StudioTextAutoSize }))} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t(`studio.text.autoSizeHints.${first.autoSize}`)}</p>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.text.language")}</span>
          <Select
            size="sm"
            value={first.language ?? ""}
            ariaLabel={t("studio.text.language")}
            options={[{ value: "", label: t("studio.text.languageAuto") }, ...TEXT_LANGUAGES.map((code) => ({ value: code, label: languageLabel(code) }))]}
            onChange={(value) => change(() => ({ language: value || null }))}
          />
        </label>
        <SwitchField label={t("studio.text.spellCheck")} checked={spellCheck} onChange={setSpellCheck} />
      </PanelSection>
      <PanelSection title={t("studio.text.effects")}>
        <SwitchField label={t("studio.text.outline")} checked={first.outline !== null} onChange={(on) => change(() => ({ outline: on ? DEFAULT_OUTLINE : null }))} />
        {first.outline ? (
          <>
            <ColorField label={t("studio.text.outlineColor")} value={first.outline.color} onChange={(color) => change((element) => ({ outline: { ...(element.outline ?? DEFAULT_OUTLINE), color } }))} />
            <SliderField label={t("studio.text.outlineWidth")} value={first.outline.width} min={0.25} max={10} step={0.25} format={(value) => `${value} pt`} onChange={(width) => change((element) => ({ outline: { ...(element.outline ?? DEFAULT_OUTLINE), width } }), "outline-width")} />
          </>
        ) : null}
        <SwitchField label={t("studio.text.shadow")} hint={t("studio.text.shadowHint")} checked={first.shadow !== null} onChange={(on) => change(() => ({ shadow: on ? DEFAULT_SHADOW : null }))} />
        {first.shadow ? (
          <>
            <ColorField label={t("studio.text.shadowColor")} value={first.shadow.color} onChange={(color) => change((element) => ({ shadow: { ...(element.shadow ?? DEFAULT_SHADOW), color } }))} />
            <div className="grid grid-cols-2 gap-x-3">
              <SliderField label={t("studio.text.shadowX")} value={first.shadow.x} min={-50} max={50} step={0.5} format={(value) => `${value} pt`} onChange={(x) => change((element) => ({ shadow: { ...(element.shadow ?? DEFAULT_SHADOW), x } }), "shadow-x")} />
              <SliderField label={t("studio.text.shadowY")} value={first.shadow.y} min={-50} max={50} step={0.5} format={(value) => `${value} pt`} onChange={(y) => change((element) => ({ shadow: { ...(element.shadow ?? DEFAULT_SHADOW), y } }), "shadow-y")} />
            </div>
            <SliderField label={t("studio.text.shadowOpacity")} value={Math.round(first.shadow.opacity * 100)} min={0} max={100} format={(value) => `${value}%`} onChange={(value) => change((element) => ({ shadow: { ...(element.shadow ?? DEFAULT_SHADOW), opacity: value / 100 } }), "shadow-opacity")} />
          </>
        ) : null}
        <SwitchField label={t("studio.text.highlight")} checked={first.highlight !== null} onChange={(on) => change(() => ({ highlight: on ? DEFAULT_HIGHLIGHT : null }))} />
        {first.highlight ? (
          <>
            <ColorField label={t("studio.text.highlightColor")} value={first.highlight.color} onChange={(color) => change((element) => ({ highlight: { ...(element.highlight ?? DEFAULT_HIGHLIGHT), color } }))} />
            <SliderField label={t("studio.text.highlightPadding")} value={first.highlight.padding} min={0} max={40} step={0.5} format={(value) => `${value} pt`} onChange={(padding) => change((element) => ({ highlight: { ...(element.highlight ?? DEFAULT_HIGHLIGHT), padding } }), "highlight-padding")} />
          </>
        ) : null}
      </PanelSection>
    </>
  );
}
