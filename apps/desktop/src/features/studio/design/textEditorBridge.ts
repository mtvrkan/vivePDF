import type { RunStyle, StylePatch } from "./richText";

type Bridge = { applyStyle: (patch: StylePatch) => void; summary: () => RunStyle | null; commit: () => void; insert: (text: string) => void };

export const textEditorBridge: { current: Bridge | null } = { current: null };
