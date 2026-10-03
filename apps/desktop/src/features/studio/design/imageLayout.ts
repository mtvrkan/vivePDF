import type { StudioCrop, StudioImageFit } from "@/types/studio";

export type ImagePlacement = {
  frame: { left: number; top: number; width: number; height: number };
  image: { left: number; top: number; width: number; height: number };
};

export function placeImage(natural: { width: number; height: number }, crop: StudioCrop, fit: StudioImageFit, box: { width: number; height: number }): ImagePlacement {
  let visible = { x: crop.x * natural.width, y: crop.y * natural.height, width: crop.width * natural.width, height: crop.height * natural.height };
  const aspect = box.width / box.height;
  if (fit === "cover") {
    if (visible.width / visible.height > aspect) {
      const kept = visible.height * aspect;
      visible = { ...visible, x: visible.x + (visible.width - kept) / 2, width: kept };
    } else {
      const kept = visible.width / aspect;
      visible = { ...visible, y: visible.y + (visible.height - kept) / 2, height: kept };
    }
  }
  let frame = { left: 0, top: 0, width: box.width, height: box.height };
  if (fit === "contain") {
    const scale = Math.min(box.width / visible.width, box.height / visible.height);
    const width = visible.width * scale;
    const height = visible.height * scale;
    frame = { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
  }
  const scaleX = frame.width / visible.width;
  const scaleY = frame.height / visible.height;
  return {
    frame,
    image: { left: -visible.x * scaleX, top: -visible.y * scaleY, width: natural.width * scaleX, height: natural.height * scaleY },
  };
}
