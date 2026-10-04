import type { Bounds } from "../model/edit";
import { MIN_SIDE, handleSigns, resizeBox, type Box, type Handle } from "./transform";

export type Axis = "x" | "y";
export type SnapLine = { axis: Axis; position: number; from: number; to: number };
export type Span = { axis: Axis; from: number; to: number; at: number };
export type SnapExtras = { x: number[]; y: number[] };

type Target = { value: number; from: number; to: number };

export type SnapIndex = { x: Target[]; y: Target[]; boxes: Bounds[]; width: number; height: number };

const EPSILON = 0.01;
const GAP_EPSILON = 0.05;
const CHAIN_LIMIT = 24;

const cross = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const low = (box: Bounds, axis: Axis) => (axis === "x" ? box.x : box.y);
const size = (box: Bounds, axis: Axis) => (axis === "x" ? box.width : box.height);
const high = (box: Bounds, axis: Axis) => low(box, axis) + size(box, axis);
const middle = (box: Bounds, axis: Axis) => low(box, axis) + size(box, axis) / 2;

export function buildSnapIndex(page: { width: number; height: number }, boxes: Bounds[], extras: SnapExtras = { x: [], y: [] }): SnapIndex {
  const x: Target[] = [0, page.width / 2, page.width, ...extras.x].map((value) => ({ value, from: 0, to: page.height }));
  const y: Target[] = [0, page.height / 2, page.height, ...extras.y].map((value) => ({ value, from: 0, to: page.width }));
  for (const box of boxes) {
    for (const value of [box.x, box.x + box.width / 2, box.x + box.width]) x.push({ value, from: box.y, to: box.y + box.height });
    for (const value of [box.y, box.y + box.height / 2, box.y + box.height]) y.push({ value, from: box.x, to: box.x + box.width });
  }
  x.sort((left, right) => left.value - right.value);
  y.sort((left, right) => left.value - right.value);
  return { x, y, boxes, width: page.width, height: page.height };
}

function firstAtLeast(targets: Target[], value: number): number {
  let lowIndex = 0;
  let highIndex = targets.length;
  while (lowIndex < highIndex) {
    const mid = (lowIndex + highIndex) >> 1;
    if (targets[mid].value < value) lowIndex = mid + 1;
    else highIndex = mid;
  }
  return lowIndex;
}

export function nearestTarget(targets: Target[], value: number, tolerance: number): { value: number; offset: number } | null {
  let best: { value: number; offset: number } | null = null;
  for (let index = firstAtLeast(targets, value - tolerance); index < targets.length && targets[index].value <= value + tolerance; index += 1) {
    const offset = targets[index].value - value;
    if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { value: targets[index].value, offset };
  }
  return best;
}

function alignOffset(targets: Target[], edges: number[], tolerance: number): { value: number; offset: number } | null {
  let best: { value: number; offset: number } | null = null;
  for (const edge of edges) {
    const found = nearestTarget(targets, edge, tolerance);
    if (found && (!best || Math.abs(found.offset) < Math.abs(best.offset))) best = found;
  }
  return best;
}

function lineAt(targets: Target[], axis: Axis, value: number, box: Bounds): SnapLine {
  const other = cross(axis);
  let from = low(box, other);
  let to = high(box, other);
  for (let index = firstAtLeast(targets, value - EPSILON); index < targets.length && targets[index].value <= value + EPSILON; index += 1) {
    from = Math.min(from, targets[index].from);
    to = Math.max(to, targets[index].to);
  }
  return { axis, position: value, from, to };
}

function linesFor(index: SnapIndex, box: Bounds, axis: Axis, edges: number[]): SnapLine[] {
  const targets = axis === "x" ? index.x : index.y;
  const lines: SnapLine[] = [];
  for (const edge of edges) {
    const hit = nearestTarget(targets, edge, EPSILON);
    if (hit && !lines.some((line) => Math.abs(line.position - hit.value) < EPSILON)) lines.push(lineAt(targets, axis, hit.value, box));
  }
  return lines;
}

function edgesOf(box: Bounds, axis: Axis): number[] {
  return [low(box, axis), middle(box, axis), high(box, axis)];
}

function overlapsAcross(a: Bounds, b: Bounds, axis: Axis): boolean {
  const other = cross(axis);
  return low(a, other) < high(b, other) - EPSILON && low(b, other) < high(a, other) - EPSILON;
}

function before(boxes: Bounds[], box: Bounds, axis: Axis, slack = EPSILON): Bounds | null {
  let best: Bounds | null = null;
  for (const other of boxes) {
    if (other === box || !overlapsAcross(other, box, axis) || high(other, axis) > low(box, axis) + slack || middle(other, axis) >= middle(box, axis)) continue;
    if (!best || high(other, axis) > high(best, axis)) best = other;
  }
  return best;
}

function after(boxes: Bounds[], box: Bounds, axis: Axis, slack = EPSILON): Bounds | null {
  let best: Bounds | null = null;
  for (const other of boxes) {
    if (other === box || !overlapsAcross(other, box, axis) || low(other, axis) < high(box, axis) - slack || middle(other, axis) <= middle(box, axis)) continue;
    if (!best || low(other, axis) < low(best, axis)) best = other;
  }
  return best;
}

function spanBetween(first: Bounds, second: Bounds, axis: Axis): Span {
  const other = cross(axis);
  const from = Math.max(low(first, other), low(second, other));
  const to = Math.min(high(first, other), high(second, other));
  return { axis, from: high(first, axis), to: low(second, axis), at: (from + to) / 2 };
}

type Spacing = { offset: number; spans: (moved: Bounds) => Span[] };

function chain(boxes: Bounds[], start: Bounds, axis: Axis, gap: number, direction: -1 | 1): Span[] {
  const spans: Span[] = [];
  let current = start;
  for (let step = 0; step < CHAIN_LIMIT; step += 1) {
    const next = direction < 0 ? before(boxes, current, axis) : after(boxes, current, axis);
    if (!next) break;
    const distance = direction < 0 ? low(current, axis) - high(next, axis) : low(next, axis) - high(current, axis);
    if (Math.abs(distance - gap) > GAP_EPSILON) break;
    spans.push(direction < 0 ? spanBetween(next, current, axis) : spanBetween(current, next, axis));
    current = next;
  }
  return spans;
}

function spacingOffset(index: SnapIndex, moving: Bounds, axis: Axis, tolerance: number): Spacing | null {
  const boxes = index.boxes;
  const previous = before(boxes, moving, axis, tolerance);
  const next = after(boxes, moving, axis, tolerance);
  const options: Spacing[] = [];
  if (previous && next) {
    const free = low(next, axis) - high(previous, axis) - size(moving, axis);
    if (free >= 0) {
      options.push({ offset: high(previous, axis) + free / 2 - low(moving, axis), spans: (moved) => [spanBetween(previous, moved, axis), spanBetween(moved, next, axis)] });
    }
  }
  if (previous) {
    const outer = before(boxes, previous, axis);
    const gap = outer ? low(previous, axis) - high(outer, axis) : -1;
    if (outer && gap >= 0) {
      options.push({ offset: high(previous, axis) + gap - low(moving, axis), spans: (moved) => [...chain(boxes, previous, axis, gap, -1), spanBetween(previous, moved, axis)] });
    }
  }
  if (next) {
    const outer = after(boxes, next, axis);
    const gap = outer ? low(outer, axis) - high(next, axis) : -1;
    if (outer && gap >= 0) {
      options.push({ offset: low(next, axis) - gap - high(moving, axis), spans: (moved) => [spanBetween(moved, next, axis), ...chain(boxes, next, axis, gap, 1)] });
    }
  }
  let best: Spacing | null = null;
  for (const option of options) {
    if (Math.abs(option.offset) <= tolerance && (!best || Math.abs(option.offset) < Math.abs(best.offset))) best = option;
  }
  return best;
}

export type MoveSnap = { dx: number; dy: number; lines: SnapLine[]; spans: Span[] };

export function snapMove(moving: Bounds, index: SnapIndex, tolerance: number): MoveSnap {
  const result: MoveSnap = { dx: 0, dy: 0, lines: [], spans: [] };
  const spacing: Partial<Record<Axis, Spacing>> = {};
  for (const axis of ["x", "y"] as const) {
    const aligned = alignOffset(axis === "x" ? index.x : index.y, edgesOf(moving, axis), tolerance);
    const spaced = spacingOffset(index, moving, axis, tolerance);
    const useSpacing = spaced && (!aligned || Math.abs(spaced.offset) < Math.abs(aligned.offset) - EPSILON);
    const offset = useSpacing ? spaced.offset : (aligned?.offset ?? 0);
    if (useSpacing) spacing[axis] = spaced;
    if (axis === "x") result.dx = offset;
    else result.dy = offset;
  }
  const moved = { ...moving, x: moving.x + result.dx, y: moving.y + result.dy };
  for (const axis of ["x", "y"] as const) {
    const spaced = spacing[axis];
    if (spaced) result.spans.push(...spaced.spans(moved));
    else result.lines.push(...linesFor(index, moved, axis, edgesOf(moved, axis)));
  }
  return result;
}

export function measureAround(index: SnapIndex, box: Bounds): Span[] {
  const spans: Span[] = [];
  for (const axis of ["x", "y"] as const) {
    const other = cross(axis);
    const centre = middle(box, other);
    const extent = axis === "x" ? index.width : index.height;
    const previous = before(index.boxes, box, axis);
    const next = after(index.boxes, box, axis);
    if (previous) spans.push(spanBetween(previous, box, axis));
    else if (low(box, axis) > EPSILON && low(box, axis) <= extent) spans.push({ axis, from: 0, to: low(box, axis), at: centre });
    if (next) spans.push(spanBetween(box, next, axis));
    else if (high(box, axis) < extent - EPSILON && high(box, axis) >= 0) spans.push({ axis, from: high(box, axis), to: extent, at: centre });
  }
  return spans.filter((span) => span.to - span.from > EPSILON);
}

export function snapResize(start: Box, handle: Handle, dx: number, dy: number, options: { keepRatio?: boolean; fromCenter?: boolean }, index: SnapIndex, tolerance: number): { box: Box; lines: SnapLine[] } {
  const box = resizeBox(start, handle, dx, dy, options);
  if (start.rotation % 360 !== 0) return { box, lines: [] };
  const signs = handleSigns(handle);
  const movingX = signs.x ? (signs.x > 0 ? box.x + box.width : box.x) : null;
  const movingY = signs.y ? (signs.y > 0 ? box.y + box.height : box.y) : null;
  const snapX = movingX === null ? null : nearestTarget(index.x, movingX, tolerance);
  const snapY = movingY === null ? null : nearestTarget(index.y, movingY, tolerance);
  if (!snapX && !snapY) return { box, lines: [] };
  const factor = options.fromCenter ? 2 : 1;
  let nextDx = dx;
  let nextDy = dy;
  if (options.keepRatio && signs.x && signs.y && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const useX = snapX && (!snapY || Math.abs(snapX.offset) <= Math.abs(snapY.offset));
    const width = useX ? box.width + factor * snapX.offset * signs.x : (box.height + factor * (snapY as { offset: number }).offset * signs.y) * ratio;
    nextDx = (width - start.width) / (signs.x * factor);
    nextDy = (width / ratio - start.height) / (signs.y * factor);
  } else {
    if (snapX) nextDx += snapX.offset;
    if (snapY) nextDy += snapY.offset;
  }
  const snapped = resizeBox(start, handle, nextDx, nextDy, options);
  if (snapped.width <= MIN_SIDE || snapped.height <= MIN_SIDE) return { box, lines: [] };
  const lines = [
    ...(movingX === null ? [] : linesFor(index, snapped, "x", [signs.x > 0 ? snapped.x + snapped.width : snapped.x])),
    ...(movingY === null ? [] : linesFor(index, snapped, "y", [signs.y > 0 ? snapped.y + snapped.height : snapped.y])),
  ];
  return { box: snapped, lines };
}

export function snapPosition(index: SnapIndex, axis: Axis, value: number, tolerance: number): number {
  return nearestTarget(axis === "x" ? index.x : index.y, value, tolerance)?.value ?? value;
}
