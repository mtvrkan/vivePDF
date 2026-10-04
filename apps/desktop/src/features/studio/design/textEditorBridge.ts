import type { StudioParagraph, StudioTextElement } from "@/types/studio";
import type { RunStyle, StylePatch } from "./richText";

export type ParagraphChange = (selected: StudioParagraph[]) => (paragraph: StudioParagraph) => StudioParagraph;

type Bridge = {
  applyStyle: (patch: StylePatch) => void;
  applyParagraphs: (change: ParagraphChange) => void;
  update: (change: (current: StudioTextElement) => StudioTextElement) => void;
  summary: () => RunStyle | null;
  selectedParagraphs: () => StudioParagraph[];
  selectedText: () => string;
  commit: () => void;
  insert: (text: string) => void;
};

export const textEditorBridge: { current: Bridge | null } = { current: null };

export const textEditorEntry: { point: { x: number; y: number } | null } = { point: null };
