import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { imagePreview } from "@/shared/rpc/operations";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import type { EditorImageBlock } from "@/types";

export type ImageChangePending = Extract<EditorPending, { kind: "imageChange" }>;

export function imageChangeFromBlock(block: EditorImageBlock, pageIndex: number): ImageChangePending {
  const [x0, y0, x1, y1] = block.bbox;
  const rect = { x: x0, y: y0, width: Math.max(x1 - x0, 4), height: Math.max(y1 - y0, 4) };
  return { id: crypto.randomUUID(), kind: "imageChange", pageIndex, blockId: block.id, xref: block.xref, ...rect, original: { ...rect }, deleted: false, aspect: rect.width / rect.height, aspectLocked: true, replacement: null, rotate: 0, flipH: false, flipV: false, opacity: 1, placementRotation: block.placementRotation ?? 0 };
}

export const REPLACE_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "heic", "heif"];

export async function pickReplacementImage(): Promise<string | null> {
  const selectedPath = await openDialog({ multiple: false, directory: false, filters: [{ name: "images", extensions: REPLACE_IMAGE_EXTENSIONS }] });
  return typeof selectedPath === "string" ? selectedPath : null;
}

export function placedAspect(width: number, height: number, placementRotation: number): number {
  return placementRotation === 90 || placementRotation === 270 ? height / width : width / height;
}

export async function replaceImageAt(item: ImageChangePending, path: string): Promise<void> {
  const token = useViewerOverlayStore.getState().sessionToken;
  const preview = await imagePreview({ path });
  const store = useViewerOverlayStore.getState();
  if (store.sessionToken !== token || !store.objects.some((entry) => entry.id === item.id)) return;
  const aspect = placedAspect(preview.width, preview.height, item.placementRotation);
  store.snapshot();
  store.updateObject(item.id, { replacement: { dataUrl: `data:image/png;base64,${preview.pngBase64}`, width: preview.width, height: preview.height, path }, aspect, height: item.width / aspect, rotate: 0, flipH: false, flipV: false });
}

export async function replaceImageWithDialog(item: ImageChangePending, t: TFunction): Promise<void> {
  const path = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.scan.photo.images"), extensions: REPLACE_IMAGE_EXTENSIONS }] });
  if (typeof path !== "string") return;
  await replaceImageAt(item, path);
}
