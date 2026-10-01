import type { TFunction } from "i18next";
import { joinPath } from "@/shared/lib/paths";
import { cleanFolderName, type WatchRule } from "@/shared/store/watchStore";
import { normalizePath } from "./pathRelation";

export type SortingFolders = { processed: string; failed: string };

export function sortingFolders(rule: WatchRule, t: TFunction): SortingFolders | null {
  if (!rule.moveSources) return null;
  const processed = rule.processedName || cleanFolderName(t("tools.watch.processedDefault")) || "Processed";
  const failed = rule.failedName || cleanFolderName(t("tools.watch.failedDefault")) || "Failed";
  return { processed: joinPath(rule.folder, processed), failed: joinPath(rule.folder, failed) };
}

export function insideFolder(path: string, folder: string): boolean {
  const base = normalizePath(folder);
  return base !== "" && normalizePath(path).startsWith(`${base}/`);
}

export function catchUpExcludes(rule: WatchRule, sorting: SortingFolders | null): string[] {
  return [rule.outputDir, sorting?.processed, sorting?.failed].filter((item): item is string => Boolean(item));
}

export function watchSignature(rule: WatchRule): string {
  return `${normalizePath(rule.folder)}|${rule.recursive}|${normalizePath(rule.outputDir)}|${rule.chainId ?? ""}`;
}
