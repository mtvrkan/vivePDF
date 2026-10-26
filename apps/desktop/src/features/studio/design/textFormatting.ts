import { useEffect, useState } from "react";
import type { StudioParagraph, StudioTextElement } from "@/types/studio";
import { MAX_RUN_SCALE, MIN_RUN_SCALE } from "../model/design";
import { fitParagraphs, paragraphCount, weightOf } from "../model/typography";
import { patchSelected } from "./commands";
import { boldPatch, runStyle, updateParagraphs, withElementStyle, type RunStyle, type StylePatch } from "./richText";
import { textEditorBridge, type ParagraphChange } from "./textEditorBridge";
import { useStudioStore } from "./studioStore";

export type TextFlag = "bold" | "italic" | "underline" | "strike";
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

function sharedRunStyle(elements: StudioTextElement[], base: RunStyle): RunStyle {
  const styles = elements.flatMap((element) => element.runs.filter((run) => run.text.trim()).map((run) => runStyle(element, run)));
  if (!styles.length) return base;
  const baseline = styles.every((style) => style.baseline === styles[0].baseline) ? styles[0].baseline : null;
  const highlight = styles.every((style) => style.highlight === styles[0].highlight) ? styles[0].highlight : null;
  return { ...base, baseline, highlight };
}

export function allParagraphs(element: StudioTextElement): StudioParagraph[] {
  return fitParagraphs(element.paragraphs, paragraphCount(element.runs));
}

export function useTextFormatting(elements: StudioTextElement[]) {
  const first = elements[0];
  const editingId = useStudioStore((state) => state.editingId);
  const editing = elements.length === 1 && editingId === first.id;
  const live = useLiveSelection(editing);
  const base = runStyle(first, { text: "" });
  const style = live?.style ?? sharedRunStyle(elements, base);
  const paragraphs = editing && live ? live.paragraphs : allParagraphs(first);

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
  const toggle = (key: TextFlag) => {
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

  return {
    first,
    style,
    paragraphs,
    weight: weightOf(style.bold, style.weight),
    shownSize: Math.round(style.scale * first.fontSize * 10) / 10,
    change,
    applyStyle,
    toggle,
    applyParagraphs,
    setSize,
  };
}
