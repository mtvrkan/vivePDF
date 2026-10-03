import { open as openDialog } from "@tauri-apps/plugin-dialog";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"];

export async function pickImage(title: string, options: { drawings?: boolean } = {}): Promise<string | null> {
  const extensions = options.drawings ? [...IMAGE_EXTENSIONS, "svg"] : IMAGE_EXTENSIONS;
  const chosen = await openDialog({ multiple: false, directory: false, title, filters: [{ name: "Images", extensions }] });
  return typeof chosen === "string" ? chosen : null;
}
