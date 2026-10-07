import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { BlockRun } from "@/shared/store/viewerOverlayStore";
import { renderRuns, type RunStyler } from "./runRender";

const MIN_SIZE_PT = 5;
const STEP_PT = 0.5;

export function FitText({
  runs,
  runStyle,
  style,
  className,
  baseSizePt,
  pxPerPt,
  boxWidth,
  boxHeight,
  onFittedSize,
}: {
  runs: BlockRun[];
  runStyle: (run: BlockRun, scaledSizePx: number) => CSSProperties;
  style: CSSProperties;
  className?: string;
  baseSizePt: number;
  pxPerPt: number;
  boxWidth?: number;
  boxHeight?: number;
  onFittedSize?: (sizePt: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sizePt, setSizePt] = useState(baseSizePt);
  const text = runs.map((run) => run.text).join("");

  useLayoutEffect(() => {
    setSizePt(baseSizePt);
  }, [text, baseSizePt, style.lineHeight, style.fontWeight, boxWidth, boxHeight]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.scrollHeight > element.clientHeight + 1 && sizePt > MIN_SIZE_PT) {
      setSizePt((current) => Math.max(MIN_SIZE_PT, current - STEP_PT));
    } else {
      onFittedSize?.(sizePt < baseSizePt ? Math.round(sizePt * 10) / 10 : null);
    }
  }, [sizePt, text, baseSizePt, onFittedSize]);

  const ratio = baseSizePt > 0 ? sizePt / baseSizePt : 1;
  const runStyler: RunStyler = (run) => runStyle(run, run.size * ratio * pxPerPt);

  return (
    <div ref={ref} className={className} style={{ ...style, fontSize: sizePt * pxPerPt, overflow: "hidden" }}>
      {renderRuns(runs, runStyler)}
    </div>
  );
}
