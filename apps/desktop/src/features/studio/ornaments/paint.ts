import type { StudioDash, StudioFill, StudioStroke, StudioVectorPath } from "@/types/studio";
import { mapPoints, polyline, toD, type Segment } from "./geometry";

export type OrnamentColors = { primary: string; secondary: string };

export type VectorArt = {
  viewWidth: number;
  viewHeight: number;
  paths: StudioVectorPath[];
};

export const TAU = Math.PI * 2;

export function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a
    .map((value, index) =>
      Math.round(value + (b[index] - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export const darker = (color: string, amount = 0.28) => mix(color, "#000000", amount);
export const lighter = (color: string, amount = 0.35) => mix(color, "#ffffff", amount);
export const solid = (color: string): StudioFill => ({ type: "solid", color });
export const NONE: StudioFill = { type: "none" };
export const line = (color: string, width: number, dash: StudioDash = "solid"): StudioStroke => ({ color, width, dash });

export function shape(segments: Segment[], fill: StudioFill, stroke: StudioStroke | null = null, options: { evenOdd?: boolean; opacity?: number } = {}): StudioVectorPath {
  return {
    d: toD(segments),
    fill,
    stroke,
    evenOdd: options.evenOdd ?? false,
    opacity: options.opacity ?? 1,
  };
}

export function rectangle(x: number, y: number, width: number, height: number): Segment[] {
  return polyline(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    true,
  );
}

export function mirrored(segments: Segment[], width: number, height: number, horizontal: boolean, vertical: boolean): Segment[] {
  return mapPoints(segments, ([x, y]) => [horizontal ? width - x : x, vertical ? height - y : y]);
}

export function fourCorners(piece: Segment[], width: number, height: number): Segment[] {
  return [piece, mirrored(piece, width, height, true, false), mirrored(piece, width, height, false, true), mirrored(piece, width, height, true, true)].flat();
}
