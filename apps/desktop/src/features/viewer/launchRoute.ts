import { extensionOf } from "@/shared/lib/paths";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"]);

export function routeForLaunch(tool: string, path: string | undefined): string | null {
  switch (tool) {
    case "compress":
      return "/tools/compress";
    case "ocr":
      return "/tools/ocr";
    case "docx":
      return "/tools/convert?mode=docx";
    case "security":
      return "/tools/security?tab=encrypt";
    case "rename":
      return "/tools/rename";
    case "batch":
      return "/tools/batch";
    case "merge":
      return "/tools/merge";
    case "privacy":
      return "/tools/security?tab=privacy";
    case "scan":
      return "/tools/scan?tab=enhance";
    case "topdf":
      return path && IMAGE_EXTENSIONS.has(extensionOf(path)) ? "/tools/convert?mode=images-to-pdf" : "/tools/convert?mode=file-to-pdf";
    default:
      return null;
  }
}

