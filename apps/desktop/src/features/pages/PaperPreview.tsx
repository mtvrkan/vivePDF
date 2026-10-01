import { memo, useMemo } from "react";
import type { PaperPattern } from "@/types";
import { MARGIN_COLOR, paperMarks } from "./paperPattern";

const DOT_SCALE = 150;

type PaperPreviewProps = { width: number; height: number; paper: PaperPattern; className?: string };

export const PaperPreview = memo(function PaperPreview({ width, height, paper, className }: PaperPreviewProps) {
  const marks = useMemo(() => paperMarks(width, height, paper), [width, height, paper]);
  const path = (kind: string) =>
    marks.lines
      .filter((line) => line.kind === kind)
      .map((line) => `M${line.x0.toFixed(2)} ${line.y0.toFixed(2)}L${line.x1.toFixed(2)} ${line.y1.toFixed(2)}`)
      .join("");
  const dots = marks.dots.map(([x, y]) => `M${x.toFixed(2)} ${y.toFixed(2)}h0`).join("");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      <path d={path("rule")} stroke={paper.color} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      <path d={path("guide")} stroke={paper.color} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" fill="none" />
      <path d={path("margin")} stroke={MARGIN_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      <path d={dots} stroke={paper.color} strokeWidth={Math.max(marks.dotRadius * 2, width / DOT_SCALE)} strokeLinecap="round" fill="none" />
    </svg>
  );
});
