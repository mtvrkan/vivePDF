import type { StudioCrop } from "@/types/studio";

export const MAX_PHOTO_ZOOM = 4;

export type PhotoView = { zoom: number; centerX: number; centerY: number };

export function viewOfCrop(crop: StudioCrop | null, width: number, height: number): PhotoView {
  if (!crop) return { zoom: 1, centerX: 0.5, centerY: 0.5 };
  const side = crop.width * width;
  return { zoom: Math.max(1, Math.min(MAX_PHOTO_ZOOM, Math.min(width, height) / Math.max(side, 1))), centerX: crop.x + crop.width / 2, centerY: crop.y + crop.height / 2 };
}

export function cropOfView(view: PhotoView, width: number, height: number): StudioCrop {
  const side = Math.min(width, height) / view.zoom;
  const cropWidth = side / width;
  const cropHeight = side / height;
  const x = Math.max(0, Math.min(1 - cropWidth, view.centerX - cropWidth / 2));
  const y = Math.max(0, Math.min(1 - cropHeight, view.centerY - cropHeight / 2));
  return { x, y, width: cropWidth, height: cropHeight };
}

export function clampView(view: PhotoView, width: number, height: number): PhotoView {
  const crop = cropOfView(view, width, height);
  return { zoom: view.zoom, centerX: crop.x + crop.width / 2, centerY: crop.y + crop.height / 2 };
}
