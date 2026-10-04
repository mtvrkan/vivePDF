import type { StudioElement } from "@/types/studio";
import { elementBounds, type Bounds } from "../model/edit";

export type Box = { x: number; y: number; width: number; height: number; rotation: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const MIN_SIDE = 2;
export const ROTATION_STEP = 15;
export const ROTATION_MAGNET = 3;

export type Vector = { x: number; y: number };

function rotate(point: Vector, degrees: number): Vector {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function handleSigns(handle: Handle): Vector {
  return { x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0, y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0 };
}

export function resizeBox(start: Box, handle: Handle, dx: number, dy: number, options: { keepRatio?: boolean; fromCenter?: boolean } = {}): Box {
  const signs = handleSigns(handle);
  const local = rotate({ x: dx, y: dy }, -start.rotation);
  const factor = options.fromCenter ? 2 : 1;
  let width = signs.x ? start.width + signs.x * local.x * factor : start.width;
  let height = signs.y ? start.height + signs.y * local.y * factor : start.height;
  if (options.keepRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (signs.x && signs.y) {
      if (Math.abs(width / start.width) > Math.abs(height / start.height)) height = width / ratio;
      else width = height * ratio;
    } else if (signs.x) height = width / ratio;
    else width = height * ratio;
  }
  width = Math.max(MIN_SIDE, width);
  height = Math.max(MIN_SIDE, height);
  const centre = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  if (options.fromCenter) return { ...start, x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  const anchorBefore = rotate({ x: (-signs.x * start.width) / 2, y: (-signs.y * start.height) / 2 }, start.rotation);
  const anchorWorld = { x: centre.x + anchorBefore.x, y: centre.y + anchorBefore.y };
  const anchorAfter = rotate({ x: (-signs.x * width) / 2, y: (-signs.y * height) / 2 }, start.rotation);
  const nextCentre = { x: anchorWorld.x - anchorAfter.x, y: anchorWorld.y - anchorAfter.y };
  return { ...start, x: nextCentre.x - width / 2, y: nextCentre.y - height / 2, width, height };
}

export function normalizeAngle(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}

export function rotationFromPointer(centre: Vector, pointer: Vector, options: { step?: boolean } = {}): number {
  const raw = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
  if (options.step) return normalizeAngle(Math.round(raw / ROTATION_STEP) * ROTATION_STEP);
  const nearest = Math.round(raw / 45) * 45;
  return normalizeAngle(Math.abs(raw - nearest) <= ROTATION_MAGNET ? nearest : Math.round(raw * 10) / 10);
}

export function scaleElements<T extends StudioElement>(elements: T[], from: Bounds, to: Bounds): T[] {
  const scaleX = to.width / Math.max(from.width, 0.001);
  const scaleY = to.height / Math.max(from.height, 0.001);
  const uniform = Math.abs(scaleX - scaleY) < 1e-6;
  return elements.map((element) => {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const nextCx = to.x + (cx - from.x) * scaleX;
    const nextCy = to.y + (cy - from.y) * scaleY;
    const width = Math.max(MIN_SIDE, element.width * scaleX);
    const height = Math.max(MIN_SIDE, element.height * scaleY);
    const scaled = { ...element, x: nextCx - width / 2, y: nextCy - height / 2, width, height };
    if (element.kind === "text" && uniform) return { ...scaled, fontSize: Math.max(1, Math.min(1000, element.fontSize * scaleX)) };
    return scaled;
  });
}

export function scaleBoundsByHandle(start: Bounds, handle: Handle, dx: number, dy: number, keepRatio: boolean, fromCenter = false): Bounds {
  const box = resizeBox({ ...start, rotation: 0 }, handle, dx, dy, { keepRatio, fromCenter });
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function pointerAngle(centre: Vector, pointer: Vector): number {
  return (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI;
}

export function turnFromPointer(centre: Vector, origin: Vector, pointer: Vector, options: { step?: boolean } = {}): number {
  const raw = normalizeAngle(pointerAngle(centre, pointer) - pointerAngle(centre, origin));
  if (options.step) return normalizeAngle(Math.round(raw / ROTATION_STEP) * ROTATION_STEP);
  const nearest = Math.round(raw / 45) * 45;
  return normalizeAngle(Math.abs(raw - nearest) <= ROTATION_MAGNET ? nearest : Math.round(raw * 10) / 10);
}

export function rotateElements<T extends StudioElement>(elements: T[], centre: Vector, degrees: number): T[] {
  if (!degrees) return elements;
  return elements.map((element) => {
    const offset = rotate({ x: element.x + element.width / 2 - centre.x, y: element.y + element.height / 2 - centre.y }, degrees);
    return { ...element, x: centre.x + offset.x - element.width / 2, y: centre.y + offset.y - element.height / 2, rotation: normalizeAngle(element.rotation + degrees) };
  });
}

export function boundsOf(elements: StudioElement[]): Bounds | null {
  if (!elements.length) return null;
  const boxes = elements.map(elementBounds);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return { x: left, y: top, width: Math.max(...boxes.map((box) => box.x + box.width)) - left, height: Math.max(...boxes.map((box) => box.y + box.height)) - top };
}
