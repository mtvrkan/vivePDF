import type { CSSProperties } from "react";

export const PAGE_COLOR_SCHEMES = ["normal", "dark", "sepia", "whiteOnBlack", "yellowOnBlack", "greenOnBlack"] as const;
export type PageColorScheme = (typeof PAGE_COLOR_SCHEMES)[number];
type DuotoneScheme = Exclude<PageColorScheme, "normal" | "dark">;
type Channels = readonly [number, number, number];

export const DARK_INVERT = 0.92;
export const DARK_FILTER = `invert(${DARK_INVERT}) hue-rotate(180deg)`;
const LUMINANCE_ROW = "0.2126 0.7152 0.0722 0 0";

export const DUOTONES: Record<DuotoneScheme, { ink: Channels; paper: Channels }> = {
  sepia: { ink: [91, 70, 54], paper: [244, 236, 216] },
  whiteOnBlack: { ink: [255, 255, 255], paper: [0, 0, 0] },
  yellowOnBlack: { ink: [255, 255, 0], paper: [0, 0, 0] },
  greenOnBlack: { ink: [0, 255, 0], paper: [0, 0, 0] },
};

export const DUOTONE_SCHEMES = Object.keys(DUOTONES) as DuotoneScheme[];

export function isPageColorScheme(value: unknown): value is PageColorScheme {
  return typeof value === "string" && (PAGE_COLOR_SCHEMES as readonly string[]).includes(value);
}

export function pageColorFilterId(scheme: DuotoneScheme): string {
  return `vivepdf-page-colors-${scheme}`;
}

export const LUMINANCE_MATRIX = [LUMINANCE_ROW, LUMINANCE_ROW, LUMINANCE_ROW, "0 0 0 1 0"].join(" ");

function channel(value: number): string {
  return String(Math.round((value / 255) * 1000) / 1000);
}

export function duotoneTables(scheme: DuotoneScheme): { r: string; g: string; b: string } {
  const { ink, paper } = DUOTONES[scheme];
  return {
    r: `${channel(ink[0])} ${channel(paper[0])}`,
    g: `${channel(ink[1])} ${channel(paper[1])}`,
    b: `${channel(ink[2])} ${channel(paper[2])}`,
  };
}

export function pageColorStyle(scheme: PageColorScheme): CSSProperties | undefined {
  if (scheme === "normal") return undefined;
  if (scheme === "dark") return { filter: DARK_FILTER };
  return { filter: `url(#${pageColorFilterId(scheme)})` };
}
