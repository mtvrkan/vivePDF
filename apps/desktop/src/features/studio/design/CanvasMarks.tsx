import type { Bounds } from "../model/edit";
import type { SnapLine, Span } from "./snapping";

export type Readout = { text: string; x: number; y: number };

const READOUT_OFFSET = 16;

export function SnapLines({ lines, zoom }: { lines: SnapLine[]; zoom: number }) {
  return lines.map((line, index) =>
    line.axis === "x" ? (
      <div key={`l${index}`} className="absolute w-px bg-destructive" style={{ left: line.position * zoom, top: line.from * zoom, height: Math.max(1, (line.to - line.from) * zoom) }} />
    ) : (
      <div key={`l${index}`} className="absolute h-px bg-destructive" style={{ top: line.position * zoom, left: line.from * zoom, width: Math.max(1, (line.to - line.from) * zoom) }} />
    ),
  );
}

export function SpanMarks({ spans, zoom, format, emphasis }: { spans: Span[]; zoom: number; format: (points: number) => string; emphasis: boolean }) {
  return spans.map((span, index) => {
    const length = (span.to - span.from) * zoom;
    const horizontal = span.axis === "x";
    return (
      <div
        key={`s${index}`}
        data-testid={emphasis ? "studio-gap" : "studio-distance"}
        className={horizontal ? "absolute flex items-center justify-center" : "absolute flex flex-col items-center justify-center"}
        style={horizontal ? { left: span.from * zoom, top: span.at * zoom - 4, width: length, height: 8 } : { top: span.from * zoom, left: span.at * zoom - 4, height: length, width: 8 }}
      >
        <span className={horizontal ? "absolute inset-y-0 left-0 w-px bg-destructive" : "absolute inset-x-0 top-0 h-px bg-destructive"} />
        <span className={horizontal ? "absolute inset-y-0 right-0 w-px bg-destructive" : "absolute inset-x-0 bottom-0 h-px bg-destructive"} />
        <span className={horizontal ? "absolute inset-x-0 top-1/2 h-px bg-destructive" : "absolute inset-y-0 left-1/2 w-px bg-destructive"} />
        {length >= 12 ? (
          <span className={emphasis ? "relative z-10 whitespace-nowrap rounded bg-destructive px-1 text-xs font-medium tabular-nums text-destructive-foreground" : "relative z-10 whitespace-nowrap rounded bg-background px-1 text-xs tabular-nums text-destructive shadow-sm"}>
            {format(span.to - span.from)}
          </span>
        ) : null}
      </div>
    );
  });
}

export function ReadoutTag({ readout, zoom }: { readout: Readout; zoom: number }) {
  return (
    <div
      aria-hidden
      data-testid="studio-readout"
      className="absolute whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-xs font-medium tabular-nums text-background shadow-md"
      style={{ left: readout.x * zoom + READOUT_OFFSET, top: readout.y * zoom + READOUT_OFFSET }}
    >
      {readout.text}
    </div>
  );
}

export function PageFrames({ width, height, margin, bleed, zoom }: { width: number; height: number; margin: number; bleed: number; zoom: number }) {
  const frames: { key: string; inset: number; className: string }[] = [];
  if (margin > 0 && margin * 2 < Math.min(width, height)) frames.push({ key: "margin", inset: margin, className: "border-primary/60" });
  if (bleed > 0 && bleed * 2 < Math.min(width, height)) frames.push({ key: "bleed", inset: bleed, className: "border-destructive/60" });
  return frames.map((frame) => (
    <div
      key={frame.key}
      data-testid={`studio-${frame.key}`}
      className={`absolute border border-dashed ${frame.className}`}
      style={{ left: frame.inset * zoom, top: frame.inset * zoom, width: (width - frame.inset * 2) * zoom, height: (height - frame.inset * 2) * zoom }}
    />
  ));
}

export function HoverOutline({ box, rotation, zoom }: { box: Bounds; rotation: number; zoom: number }) {
  return (
    <div
      data-testid="studio-hover"
      className="absolute border border-primary"
      style={{ left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
    />
  );
}
