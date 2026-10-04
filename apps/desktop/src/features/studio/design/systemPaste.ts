import type { StudioElement } from "@/types/studio";
import { textOf } from "../model/design";

export const PASTE_WAIT_MS = 60;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);

let pending: ReturnType<typeof setTimeout> | null = null;

export function expectSystemPaste(fallback: () => void) {
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    fallback();
  }, PASTE_WAIT_MS);
}

export function claimSystemPaste(): boolean {
  if (pending === null) return false;
  clearTimeout(pending);
  pending = null;
  return true;
}

export function clipboardImages(data: Pick<DataTransfer, "files" | "items"> | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter((file) => RASTER_TYPES.has(file.type));
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && RASTER_TYPES.has(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function copiedText(elements: readonly StudioElement[]): string {
  return elements
    .filter((element) => element.kind === "text")
    .map((element) => (element.kind === "text" ? textOf(element.runs) : ""))
    .join("\n");
}

export function replaceSystemClipboard(elements: readonly StudioElement[]) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) return;
  clipboard.writeText(copiedText(elements)).catch(() => undefined);
}
