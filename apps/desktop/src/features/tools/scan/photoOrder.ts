import type { PhotoRotation } from "@/types";
import { basenameOf } from "@/shared/lib/paths";

export function movePhoto(photos: string[], path: string, delta: number): string[] {
  const from = photos.indexOf(path);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= photos.length) return photos;
  const next = [...photos];
  next.splice(from, 1);
  next.splice(to, 0, path);
  return next;
}

export function sortPhotosByName(photos: string[], locale: string, descending = false): string[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sorted = [...photos].sort((a, b) => collator.compare(basenameOf(a), basenameOf(b)) || collator.compare(a, b));
  return descending ? sorted.reverse() : sorted;
}

export function nextRotation(rotation: PhotoRotation | undefined): PhotoRotation {
  return (((rotation ?? 0) + 90) % 360) as PhotoRotation;
}

export function withRotation(rotations: Record<string, PhotoRotation>, path: string, rotation: PhotoRotation | null): Record<string, PhotoRotation> {
  const next = { ...rotations };
  if (rotation) next[path] = rotation;
  else delete next[path];
  return next;
}

export function rotationParams(photos: string[], rotations: Record<string, PhotoRotation>): PhotoRotation[] | undefined {
  const list = photos.map((path) => rotations[path] ?? 0);
  return list.some((value) => value !== 0) ? list : undefined;
}
