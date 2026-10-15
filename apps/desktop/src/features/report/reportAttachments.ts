import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ReportImage } from "@/shared/store/reportStore";

const MAX_SIDE_PX = 2560;
const MAX_PNG_BYTES = 1_500_000;
const JPEG_QUALITY = 0.85;
const PLAIN_TYPES = new Set(["image/png", "image/jpeg"]);

export async function pickAttachments(title: string): Promise<string[]> {
  const chosen = await openDialog({ multiple: true, directory: false, title });
  if (Array.isArray(chosen)) return chosen;
  return typeof chosen === "string" ? [chosen] : [];
}

export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function base64OfBytes(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let start = 0; start < bytes.length; start += step) binary += String.fromCharCode(...bytes.subarray(start, start + step));
  return btoa(binary);
}

async function base64OfBlob(blob: Blob): Promise<string> {
  return base64OfBytes(new Uint8Array(await blob.arrayBuffer()));
}

async function decoded(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function encoded(bitmap: ImageBitmap, type: "image/png" | "image/jpeg"): Promise<Blob | null> {
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
}

export async function reportImageFrom(file: File, index: number): Promise<ReportImage | null> {
  const bitmap = await decoded(file);
  const oversized = bitmap !== null && Math.max(bitmap.width, bitmap.height) > MAX_SIDE_PX;
  let blob: Blob | null = PLAIN_TYPES.has(file.type) && !oversized ? file : null;
  if (bitmap && (!blob || blob.size > MAX_PNG_BYTES)) {
    const png = await encoded(bitmap, "image/png");
    blob = png && png.size <= MAX_PNG_BYTES ? png : ((await encoded(bitmap, "image/jpeg")) ?? png);
  }
  bitmap?.close();
  if (!blob || !PLAIN_TYPES.has(blob.type)) return null;
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return { id: crypto.randomUUID(), name: `screenshot-${index}.${extension}`, base64: await base64OfBlob(blob), mime: blob.type };
}
