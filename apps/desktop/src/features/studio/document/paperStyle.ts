import type { CSSProperties } from "react";
import type { DocumentSettings } from "@/types/studio";
import { fontStack } from "./documentFonts";
import { contentInsets, pageSize } from "./model";

export type PaperStyle = CSSProperties & Record<`--${string}`, string>;

export function paperStyleOf(settings: DocumentSettings, zoom: number): PaperStyle {
  const size = pageSize(settings);
  const inset = contentInsets(settings);
  return {
    width: `${size.width}pt`,
    minHeight: `${size.height}pt`,
    padding: `${inset.top}pt ${inset.right}pt ${inset.bottom}pt ${inset.left}pt`,
    zoom,
    fontSize: `${settings.fontSize}pt`,
    lineHeight: String(settings.lineHeight),
    fontFamily: fontStack(settings.fontId),
    "--doc-accent": settings.accent,
    "--doc-heading-font": fontStack(settings.headingFontId ?? settings.fontId),
    "--doc-body-height": `${size.height - inset.top - inset.bottom}pt`,
  };
}
