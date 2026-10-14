export const SPACING_LIMITS = { lineHeight: [1, 3], spaceBefore: [0, 48], spaceAfter: [0, 48], firstLineIndent: [0, 72] } as const;
export type SpacingKey = keyof typeof SPACING_LIMITS;
export type Spacing = Record<SpacingKey, number | null>;
export const SPACING_KEYS = Object.keys(SPACING_LIMITS) as SpacingKey[];
export const SPACING_TYPES = ["paragraph", "heading"];
export const LINE_PRESETS = [1, 1.15, 1.5, 2] as const;
export const PARAGRAPH_GAP = 12;
export const FIRST_LINE_INDENT = 36;

const CSS_PROPERTY: Record<SpacingKey, string> = { lineHeight: "line-height", spaceBefore: "margin-top", spaceAfter: "margin-bottom", firstLineIndent: "text-indent" };
const LENGTH = /^(-?\d+(?:\.\d+)?)(pt|px)?$/;
const PX_TO_PT = 0.75;

export function spacingValue(key: SpacingKey, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const [low, high] = SPACING_LIMITS[key];
  const clamped = Math.min(high, Math.max(low, value));
  return Math.round(clamped * 100) / 100;
}

export function spacingCss(key: SpacingKey, value: unknown): string | null {
  const checked = spacingValue(key, value);
  if (checked === null) return null;
  return key === "lineHeight" ? `${CSS_PROPERTY[key]}:${checked}` : `${CSS_PROPERTY[key]}:${checked}pt`;
}

export function parsedSpacing(key: SpacingKey, raw: string): number | null {
  const match = LENGTH.exec(raw.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (key === "lineHeight") return spacingValue(key, match[2] ? null : amount);
  return spacingValue(key, match[2] === "px" ? amount * PX_TO_PT : amount);
}

export function spacingOf(element: HTMLElement, key: SpacingKey): string {
  return element.style.getPropertyValue(CSS_PROPERTY[key]);
}
