import { outputFileName } from "./naming";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

export function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : path.includes("/") ? "/" : "\\";
}

export function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "";
}

export function basenameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

export function stemOf(path: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(path: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function joinPath(directory: string, name: string): string {
  if (!directory) return name;
  const separator = separatorOf(directory);
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`;
}

export function pathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function numberedPath(path: string, index: number): string {
  if (index < 2) return path;
  const dot = path.lastIndexOf(".");
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const hasExtension = dot > cut + 1;
  const base = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : "";
  return `${base} (${index})${extension}`;
}

export function outputDirectoryFor(sourcePath: string): string {
  const { outputMode, outputFolder } = usePreferencesStore.getState();
  return outputMode === "folder" && outputFolder ? outputFolder : dirnameOf(sourcePath);
}

export function suggestOutputPath(sourcePath: string, suffix: string, extension = "pdf"): string {
  return joinPath(outputDirectoryFor(sourcePath), `${outputFileName(stemOf(sourcePath), suffix)}.${extension}`);
}

export function siblingPath(sourcePath: string, extension: string): string {
  return joinPath(outputDirectoryFor(sourcePath), `${outputFileName(stemOf(sourcePath), "")}.${extension}`);
}

export async function defaultOutputDirectory(): Promise<string> {
  const { outputMode, outputFolder } = usePreferencesStore.getState();
  if (outputMode === "folder" && outputFolder) return outputFolder;
  try {
    const { documentDir } = await import("@tauri-apps/api/path");
    return await documentDir();
  } catch {
    return "";
  }
}

export function pageFileUrl(path: string, page: number): string {
  const forward = path.replace(/\\/g, "/");
  const rooted = forward.startsWith("/") ? forward : `/${forward}`;
  const encoded = rooted
    .split("/")
    .map((segment, index) => (index === 1 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  return `file://${encoded}#page=${Math.max(1, Math.round(page))}`;
}
