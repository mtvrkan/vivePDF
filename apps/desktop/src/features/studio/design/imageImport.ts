import { extensionOf } from "@/shared/lib/paths";
import { RpcCallError } from "@/shared/rpc/client";
import { studioImportSvg, studioSaveImage } from "@/shared/rpc/operations";
import type { StudioElement, StudioPage } from "@/types/studio";
import { createImage, createSvg } from "../model/design";
import { addElements } from "../model/edit";
import { loadImagePreview } from "./assets";
import { IMAGE_EXTENSIONS } from "./pickImage";
import { currentPage, useStudioStore } from "./studioStore";

export type Point = { x: number; y: number };

export const MAX_PASTE_BYTES = 5_500_000;
const MAX_PASTE_SIDE = 4096;
const SHARE_OF_PAGE = 0.5;
const CASCADE = 16;
const BASE64_CHUNK = 0x8000;
const DROP_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, "svg"]);

export function isImagePath(path: string): boolean {
  return DROP_EXTENSIONS.has(extensionOf(path));
}

export function fittedSize(page: Pick<StudioPage, "width" | "height">, ratio: number): { width: number; height: number } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  const width = Math.min(page.width * SHARE_OF_PAGE, safe >= 1 ? page.width * SHARE_OF_PAGE : page.height * SHARE_OF_PAGE * safe);
  return { width, height: width / safe };
}

export function placedAt(page: Pick<StudioPage, "width" | "height">, size: { width: number; height: number }, point: Point | null, index = 0): Point {
  const centre = point ?? { x: page.width / 2, y: page.height / 2 };
  return { x: centre.x - size.width / 2 + index * CASCADE, y: centre.y - size.height / 2 + index * CASCADE };
}

async function elementFor(path: string, page: StudioPage, point: Point | null, index: number): Promise<StudioElement | null> {
  if (extensionOf(path) === "svg") {
    const drawing = await studioImportSvg({ path });
    const size = fittedSize(page, drawing.width / drawing.height);
    const at = placedAt(page, size, point, index);
    return createSvg(drawing.svg, at.x, at.y, size.width, size.height);
  }
  const preview = await loadImagePreview(path);
  if (!preview) return null;
  const size = fittedSize(page, preview.width / preview.height);
  const at = placedAt(page, size, point, index);
  return createImage(path, at.x, at.y, size.width, size.height);
}

export async function insertImagePaths(paths: string[], point: Point | null, onError: (error: unknown) => void = () => undefined): Promise<string[]> {
  const page = currentPage(useStudioStore.getState());
  if (!page) return [];
  const elements: StudioElement[] = [];
  for (const path of paths) {
    try {
      const element = await elementFor(path, page, point, elements.length);
      if (element) elements.push(element);
    } catch (error) {
      onError(error);
    }
  }
  const store = useStudioStore.getState();
  if (!elements.length || currentPage(store)?.id !== page.id) return [];
  store.applyToPage((target) => addElements(target, elements));
  const ids = elements.map((element) => element.id);
  useStudioStore.getState().select(ids);
  return ids;
}

export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  return btoa(binary);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function transportable(file: Blob): Promise<Blob> {
  if (file.size <= MAX_PASTE_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PASTE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = await canvasBlob(canvas, "image/png");
  if (png && png.size <= MAX_PASTE_BYTES) return png;
  const jpeg = await canvasBlob(canvas, "image/jpeg", 0.92);
  if (jpeg && jpeg.size <= MAX_PASTE_BYTES) return jpeg;
  throw new RpcCallError({ code: "INVALID_PARAMS", message: "image is too large", data: { reason: "pictureTooLarge" } });
}

export async function pasteImageFiles(files: Blob[], onError: (error: unknown) => void = () => undefined): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    try {
      const saved = await studioSaveImage({ data: await blobBase64(await transportable(file)) });
      paths.push(saved.path);
    } catch (error) {
      onError(error);
    }
  }
  return paths.length ? insertImagePaths(paths, null, onError) : [];
}
