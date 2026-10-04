import type { StudioCrop, StudioImageElement } from "@/types/studio";
import { placeImage } from "./imageLayout";
import type { Handle, Vector } from "./transform";

export type Size = { width: number; height: number };
export type ImageRect = { left: number; top: number; width: number; height: number };
export type CropDraft = { x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; flipY: boolean; image: ImageRect };
export type CropPatch = Pick<StudioImageElement, "x" | "y" | "width" | "height" | "fit" | "crop">;

export const MIN_CROP_FRAME = 2;
export const MAX_CROP_ZOOM = 10;
const DIGITS = 1e6;

function rotate(point: Vector, degrees: number): Vector {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * DIGITS) / DIGITS;
}

export function initialDraft(natural: Size, element: StudioImageElement): CropDraft {
  const placed = placeImage(natural, element.crop, "cover", element);
  return { x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, flipX: Boolean(element.flipX), flipY: Boolean(element.flipY), image: { ...placed.image, left: placed.image.left || 0, top: placed.image.top || 0 } };
}

export function coverWidth(draft: Pick<CropDraft, "width" | "height">, aspect: number): number {
  return Math.max(draft.width, draft.height * aspect);
}

function aspectOf(image: ImageRect): number {
  return image.width / image.height;
}

export function clampImage(draft: CropDraft): CropDraft {
  const aspect = aspectOf(draft.image);
  const minimum = coverWidth(draft, aspect);
  let image = draft.image;
  if (image.width < minimum) {
    const width = minimum;
    const height = width / aspect;
    const centreX = image.left + image.width / 2;
    const centreY = image.top + image.height / 2;
    image = { left: centreX - width / 2, top: centreY - height / 2, width, height };
  }
  return { ...draft, image: { ...image, left: clamp(image.left, draft.width - image.width, 0), top: clamp(image.top, draft.height - image.height, 0) } };
}

export function zoomOf(draft: CropDraft): number {
  return draft.image.width / coverWidth(draft, aspectOf(draft.image));
}

export function zoomDraft(draft: CropDraft, zoom: number): CropDraft {
  const aspect = aspectOf(draft.image);
  const width = coverWidth(draft, aspect) * clamp(zoom, 1, MAX_CROP_ZOOM);
  const height = width / aspect;
  const anchorX = (draft.width / 2 - draft.image.left) / draft.image.width;
  const anchorY = (draft.height / 2 - draft.image.top) / draft.image.height;
  return clampImage({ ...draft, image: { left: draft.width / 2 - anchorX * width, top: draft.height / 2 - anchorY * height, width, height } });
}

export function toContent(delta: Vector, draft: Pick<CropDraft, "rotation" | "flipX" | "flipY">): Vector {
  const local = rotate(delta, -draft.rotation);
  return { x: draft.flipX ? -local.x : local.x, y: draft.flipY ? -local.y : local.y };
}

export function moveDraft(draft: CropDraft, delta: Vector): CropDraft {
  return clampImage({ ...draft, image: { ...draft.image, left: draft.image.left + delta.x, top: draft.image.top + delta.y } });
}

export function resizeFrame(start: CropDraft, handle: Handle, delta: Vector): CropDraft {
  const image = start.image;
  let left = 0;
  let top = 0;
  let right = start.width;
  let bottom = start.height;
  if (handle.includes("w")) left = clamp(delta.x, image.left, right - MIN_CROP_FRAME);
  if (handle.includes("e")) right = clamp(start.width + delta.x, left + MIN_CROP_FRAME, image.left + image.width);
  if (handle.includes("n")) top = clamp(delta.y, image.top, bottom - MIN_CROP_FRAME);
  if (handle.includes("s")) bottom = clamp(start.height + delta.y, top + MIN_CROP_FRAME, image.top + image.height);
  const width = right - left;
  const height = bottom - top;
  const visual = { x: ((left + right) / 2 - start.width / 2) * (start.flipX ? -1 : 1), y: ((top + bottom) / 2 - start.height / 2) * (start.flipY ? -1 : 1) };
  const shift = rotate(visual, start.rotation);
  const centre = { x: start.x + start.width / 2 + shift.x, y: start.y + start.height / 2 + shift.y };
  return { ...start, x: centre.x - width / 2, y: centre.y - height / 2, width, height, image: { ...image, left: image.left - left, top: image.top - top } };
}

export function draftCrop(draft: CropDraft): StudioCrop {
  const x = round(clamp(-draft.image.left / draft.image.width, 0, 0.99));
  const y = round(clamp(-draft.image.top / draft.image.height, 0, 0.99));
  return {
    x,
    y,
    width: round(clamp(draft.width / draft.image.width, 0.01, 1 - x)),
    height: round(clamp(draft.height / draft.image.height, 0.01, 1 - y)),
  };
}

export function finishDraft(draft: CropDraft): CropPatch {
  return { x: draft.x, y: draft.y, width: draft.width, height: draft.height, fit: "cover", crop: draftCrop(draft) };
}

export function resetDraft(draft: CropDraft, natural: Size): CropDraft {
  const aspect = natural.width / natural.height;
  const width = coverWidth(draft, aspect);
  const height = width / aspect;
  return { ...draft, image: { left: (draft.width - width) / 2, top: (draft.height - height) / 2, width, height } };
}
