import { cn } from "@/shared/lib/cn";
import type { StudioElement } from "@/types/studio";
import { elementBounds, type Bounds } from "../model/edit";
import { CURSORS, handlePosition, handlesFor, isLine } from "./canvasGeometry";
import { boundsOf } from "./transform";

function RotateGrip() {
  return (
    <>
      <span aria-hidden className="absolute left-1/2 h-4 w-px bg-primary" style={{ top: -18 }} />
      <span data-handle="rotate" aria-hidden className="pointer-events-auto absolute left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-primary bg-background" style={{ top: -30 }} />
    </>
  );
}

type SelectionOverlayProps = { selected: StudioElement[]; zoom: number; turn: { box: Bounds; angle: number } | null; showHandles: boolean; cropping: boolean };

export function SelectionOverlay({ selected, zoom, turn, showHandles, cropping }: SelectionOverlayProps) {
  const frame = selected.length === 1 ? selected[0] : null;
  const groupBox = turn?.box ?? (selected.length > 1 ? boundsOf(selected) : null);
  return (
    <>
      {selected.map((element) => {
        const box = elementBounds(element);
        return selected.length > 1 ? <div key={element.id} className="absolute border border-primary/60" style={{ left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom }} /> : null;
      })}
      {frame && !cropping ? (
        <div
          data-testid="studio-selection"
          className={cn("absolute border-2", frame.locked ? "border-muted-foreground" : "border-primary")}
          style={{ left: frame.x * zoom, top: frame.y * zoom, width: frame.width * zoom, height: frame.height * zoom, transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined }}
        >
          {showHandles ? (
            <>
              {handlesFor([frame]).map((handle) => {
                const spot = handlePosition(handle, frame.width * zoom, frame.height * zoom);
                return (
                  <span
                    key={handle}
                    data-handle={handle}
                    aria-hidden
                    className="pointer-events-auto absolute size-3 rounded-full border-2 border-primary bg-background"
                    style={{ left: spot.x - 6, top: spot.y - 6, cursor: CURSORS[handle] }}
                  />
                );
              })}
              {isLine(frame)
                ? (["start", "end"] as const).map((end) => (
                    <span
                      key={end}
                      data-handle={end}
                      data-testid={`studio-line-${end}`}
                      aria-hidden
                      className="pointer-events-auto absolute size-3.5 cursor-crosshair rounded-full border-2 border-primary bg-primary"
                      style={{ left: (end === "start" ? 0 : frame.width * zoom) - 7, top: (frame.height * zoom) / 2 - 7 }}
                    />
                  ))
                : null}
              <RotateGrip />
            </>
          ) : null}
        </div>
      ) : null}
      {groupBox ? (
        <div
          data-testid="studio-selection"
          className="absolute border-2 border-dashed border-primary"
          style={{ left: groupBox.x * zoom, top: groupBox.y * zoom, width: groupBox.width * zoom, height: groupBox.height * zoom, transform: turn?.angle ? `rotate(${turn.angle}deg)` : undefined }}
        >
          {showHandles && !turn ? (
            <>
              {handlesFor(selected).map((handle) => {
                const spot = handlePosition(handle, groupBox.width * zoom, groupBox.height * zoom);
                return <span key={handle} data-handle={handle} aria-hidden className="pointer-events-auto absolute size-3 rounded-full border-2 border-primary bg-background" style={{ left: spot.x - 6, top: spot.y - 6, cursor: CURSORS[handle] }} />;
              })}
              <RotateGrip />
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
