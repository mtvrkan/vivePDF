const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"];

export type DropHitKind = "image" | "block" | "empty" | "outside-page" | null;
export type DropAction = "replaceImage" | "createImage" | "ignore";

function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

export function decideDropAction(mode: string, files: { name: string }[], hitObjectKind: DropHitKind): DropAction {
  if (mode !== "text" && mode !== "image") return "ignore";
  if (files.length !== 1) return "ignore";
  if (!isImageFile(files[0].name)) return "ignore";
  if (hitObjectKind === "image" || hitObjectKind === "block") return "replaceImage";
  if (hitObjectKind === "empty" && mode === "image") return "createImage";
  return "ignore";
}

export function dropHitKindFor(hit: { source: "object" | "block"; kind: string } | null, insidePage: boolean): DropHitKind {
  if (hit?.source === "object") return hit.kind === "image" || hit.kind === "imageChange" ? "image" : null;
  if (hit?.source === "block") return hit.kind === "image" ? "block" : null;
  return insidePage ? "empty" : "outside-page";
}
