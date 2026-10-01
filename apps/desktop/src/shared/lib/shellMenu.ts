import type { ShellMenuEntry } from "@/types";

const OFFICE_EXTENSIONS = ["docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "txt", "md", "html", "htm"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];

export function shellMenuEntries(t: (key: string) => string): ShellMenuEntry[] {
  return [
    { id: "merge", label: t("shell.merge"), tool: "merge", extensions: ["pdf"] },
    { id: "compress", label: t("shell.compress"), tool: "compress", extensions: ["pdf"] },
    { id: "ocr", label: t("shell.ocr"), tool: "ocr", extensions: ["pdf"] },
    { id: "docx", label: t("shell.docx"), tool: "docx", extensions: ["pdf"] },
    { id: "security", label: t("shell.security"), tool: "security", extensions: ["pdf"] },
    { id: "privacy", label: t("shell.privacy"), tool: "privacy", extensions: ["pdf"] },
    { id: "rename", label: t("shell.rename"), tool: "rename", extensions: ["pdf"] },
    { id: "batch", label: t("shell.batch"), tool: "batch", extensions: ["pdf"] },
    { id: "topdf", label: t("shell.toPdf"), tool: "topdf", extensions: [...OFFICE_EXTENSIONS, ...IMAGE_EXTENSIONS] },
  ];
}
