import { basenameOf } from "@/shared/lib/paths";

export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "avif", "heic", "heif"];

export function isPhotoPath(path: string): boolean {
  const name = basenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && PHOTO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}
