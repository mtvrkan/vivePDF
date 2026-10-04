import type { StudioStroke, StudioVectorPath } from "@/types/studio";
import { primitivePath } from "../model/svgPath";

export type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

export type IconArt = { viewWidth: number; viewHeight: number; paths: StudioVectorPath[] };

export const ICON_VIEW = 24;
export const ICON_STROKE = 2;

export function iconArt(node: IconNode, color: string, strokeWidth = ICON_STROKE): IconArt {
  const stroke: StudioStroke = { color, width: strokeWidth, dash: "solid", cap: "round", join: "round" };
  const outlines: string[] = [];
  const filled: string[] = [];
  for (const [tag, attrs] of node) {
    const d = primitivePath(tag, attrs);
    if (!d) continue;
    const fill = attrs.fill?.trim().toLowerCase();
    if (fill && fill !== "none" && fill !== "transparent") filled.push(d);
    else outlines.push(d);
  }
  const paths: StudioVectorPath[] = [];
  if (outlines.length) paths.push({ d: outlines.join(" "), fill: { type: "none" }, stroke, evenOdd: false, opacity: 1 });
  for (const d of filled) paths.push({ d, fill: { type: "solid", color }, stroke, evenOdd: false, opacity: 1 });
  return { viewWidth: ICON_VIEW, viewHeight: ICON_VIEW, paths };
}
