import type { StudioDesign, StudioElement, StudioTextElement } from "@/types/studio";
import { heightPatch } from "../graphics/graphicData";
import { moveGuide } from "../model/guides";
import { moveElements, updateElement, updatePage, type Bounds } from "../model/edit";
import type { Point } from "./canvasGeometry";
import type { Readout } from "./CanvasMarks";
import { moveLineEnd, type LineEnd } from "./lineGeometry";
import { measureAround, snapMove, snapPoint, snapPosition, snapResize, type Axis, type SnapIndex, type SnapLine, type Span } from "./snapping";
import { ratioLocked, resizeBox, rotateElements, rotationFromPointer, scaleElements, turnFromPointer, type Handle } from "./transform";

export type MoveDrag = { kind: "move"; before: StudioDesign; base: StudioDesign; ids: string[]; original: string[]; origin: Point; moved: boolean; duplicate: boolean; index: SnapIndex; start: Bounds; anchor: Point };
export type ResizeDrag = { kind: "resize"; before: StudioDesign; handle: Handle; elements: StudioElement[]; origin: Point; start: Bounds; index: SnapIndex };
export type RotateDrag = { kind: "rotate"; before: StudioDesign; element: StudioElement };
export type EndpointDrag = { kind: "endpoint"; before: StudioDesign; element: StudioElement; which: LineEnd; grab: Point; index: SnapIndex };
export type TurnDrag = { kind: "turn"; before: StudioDesign; elements: StudioElement[]; centre: Point; origin: Point; box: Bounds };
export type GuideDrag = { kind: "guide"; before: StudioDesign; pageId: string; index: number; axis: Axis; created: boolean; removing: boolean; snap: SnapIndex };

export type Drag = MoveDrag | ResizeDrag | RotateDrag | EndpointDrag | TurnDrag | GuideDrag | { kind: "marquee"; origin: Point; base: string[] } | { kind: "pan"; origin: Point; scroll: Point };

export type Feedback = { lines: SnapLine[]; gaps: Span[]; distances: Span[]; readout: Readout | null };

export const NO_FEEDBACK: Feedback = { lines: [], gaps: [], distances: [], readout: null };

export type StepContext = {
  pageId: string;
  point: Point;
  shiftKey: boolean;
  altKey: boolean;
  snap: boolean;
  tolerance: number;
  number: (points: number) => string;
  degrees: (angle: number) => string;
};

export type DragStep = { feedback: Feedback; preview: (design: StudioDesign) => StudioDesign; turn?: { box: Bounds; angle: number } };

function placed(design: StudioDesign, pageId: string, elements: StudioElement[]): StudioDesign {
  return updatePage(design, pageId, (item) => elements.reduce((acc, element) => updateElement<StudioElement>(acc, element.id, element), item));
}

export function moveStep(current: MoveDrag, context: StepContext, delta: Point): DragStep {
  const { point } = context;
  let { x: dx, y: dy } = delta;
  let lines: SnapLine[] = [];
  let gaps: Span[] = [];
  if (context.snap) {
    const snapped = snapMove({ ...current.start, x: current.start.x + dx, y: current.start.y + dy }, current.index, context.tolerance);
    dx += snapped.dx;
    dy += snapped.dy;
    lines = snapped.lines;
    gaps = snapped.spans;
  }
  const box = { ...current.start, x: current.start.x + dx, y: current.start.y + dy };
  const distances = measureAround(current.index, box).filter((span) => !gaps.some((gap) => gap.axis === span.axis));
  const { base, ids } = current;
  return {
    feedback: { lines, gaps, distances, readout: { text: `X ${context.number(current.anchor.x + dx)}  Y ${context.number(current.anchor.y + dy)} mm`, x: point.x, y: point.y } },
    preview: () => updatePage(base, context.pageId, (item) => moveElements(item, ids, dx, dy)),
  };
}

export function guideStep(current: GuideDrag, context: StepContext, removing: boolean): DragStep {
  const { point } = context;
  const raw = current.axis === "x" ? point.x : point.y;
  const position = context.snap ? snapPosition(current.snap, current.axis, raw, context.tolerance) : raw;
  return {
    feedback: { ...NO_FEEDBACK, readout: removing ? null : { text: `${current.axis === "x" ? "X" : "Y"} ${context.number(position)} mm`, x: point.x, y: point.y } },
    preview: (next) => updatePage(next, current.pageId, (item) => moveGuide(item, current.index, position)),
  };
}

export function rotateStep(current: RotateDrag, context: StepContext): DragStep {
  const { element } = current;
  const { point } = context;
  const rotation = rotationFromPointer({ x: element.x + element.width / 2, y: element.y + element.height / 2 }, point, { step: context.shiftKey });
  return {
    feedback: { ...NO_FEEDBACK, readout: { text: context.degrees(rotation), x: point.x, y: point.y } },
    preview: () => updatePage(current.before, context.pageId, (item) => updateElement(item, element.id, { rotation })),
  };
}

export function endpointStep(current: EndpointDrag, context: StepContext): DragStep {
  const { point } = context;
  const raw = { x: point.x + current.grab.x, y: point.y + current.grab.y };
  const snapped = !context.shiftKey && context.snap ? snapPoint(current.index, raw, context.tolerance) : { ...raw, lines: [] };
  const patch = moveLineEnd(current.element, current.which, snapped, { step: context.shiftKey });
  return {
    feedback: { ...NO_FEEDBACK, lines: snapped.lines, readout: { text: `${context.number(patch.width)} mm  ${context.degrees(patch.rotation)}`, x: point.x, y: point.y } },
    preview: () => updatePage(current.before, context.pageId, (item) => updateElement<StudioElement>(item, current.element.id, patch)),
  };
}

export function turnStep(current: TurnDrag, context: StepContext): DragStep {
  const { point } = context;
  const angle = turnFromPointer(current.centre, current.origin, point, { step: context.shiftKey });
  const turned = rotateElements(current.elements, current.centre, angle);
  return {
    feedback: { ...NO_FEEDBACK, readout: { text: context.degrees(angle), x: point.x, y: point.y } },
    preview: () => placed(current.before, context.pageId, turned),
    turn: { box: current.box, angle },
  };
}

export function resizeStep(current: ResizeDrag, context: StepContext): DragStep {
  const { point } = context;
  const dx = point.x - current.origin.x;
  const dy = point.y - current.origin.y;
  if (current.elements.length === 1) {
    const element = current.elements[0];
    const corner = current.handle.length === 2;
    const keepRatio = corner && (ratioLocked(element) ? !context.shiftKey : context.shiftKey);
    const options = { keepRatio, fromCenter: context.altKey };
    const result = context.snap ? snapResize(element, current.handle, dx, dy, options, current.index, context.tolerance) : { box: resizeBox(element, current.handle, dx, dy, options), lines: [] };
    const box = result.box;
    const patch: Partial<StudioElement> = { x: box.x, y: box.y, width: box.width, ...heightPatch(element, box.height) };
    if (element.kind === "text" && corner && keepRatio) (patch as Partial<StudioTextElement>).fontSize = Math.max(1, Math.min(1000, element.fontSize * (box.width / element.width)));
    if (element.kind === "qr") patch.height = box.width;
    return {
      feedback: { ...NO_FEEDBACK, lines: result.lines, readout: { text: `${context.number(box.width)} × ${context.number(patch.height ?? box.height)} mm`, x: point.x, y: point.y } },
      preview: () => updatePage(current.before, context.pageId, (item) => updateElement(item, element.id, patch)),
    };
  }
  const options = { keepRatio: !context.shiftKey, fromCenter: context.altKey };
  const frame = { ...current.start, rotation: 0 };
  const result = context.snap ? snapResize(frame, current.handle, dx, dy, options, current.index, context.tolerance) : { box: resizeBox(frame, current.handle, dx, dy, options), lines: [] };
  const target = { x: result.box.x, y: result.box.y, width: result.box.width, height: result.box.height };
  const scaled = scaleElements(current.elements, current.start, target);
  return {
    feedback: { ...NO_FEEDBACK, lines: result.lines, readout: { text: `${context.number(target.width)} × ${context.number(target.height)} mm`, x: point.x, y: point.y } },
    preview: () => placed(current.before, context.pageId, scaled),
  };
}
