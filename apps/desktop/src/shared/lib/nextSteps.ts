import { findNavItem } from "@/app/navigation";
import type { NavItem } from "@/types";
import { isPdfPath } from "@/shared/rpc/files";

const NEXT_STEPS: Record<string, string[]> = {
  "/tools/ocr": ["compress", "convert", "search"],
  "/tools/scan": ["ocr", "compress"],
  "/tools/merge": ["edit", "compress", "security"],
  "/tools/split": ["rename", "compress"],
  "/tools/compress": ["security", "sign"],
  "/tools/convert": ["ocr", "compress"],
  "/tools/edit": ["security", "sign"],
  "/tools/security": ["sign"],
  "/tools/forms": ["sign", "security"],
  "/tools/access": ["compress"],
  "/tools/codes": ["security"],
  "/tools/rename": ["compress"],
  "/pages": ["compress", "ocr"],
  "/tools/pages": ["compress", "ocr"],
};

export function nextStepsFor(route: string, output: string | undefined): NavItem[] {
  if (!output || !isPdfPath(output)) return [];
  const ids = NEXT_STEPS[route] ?? [];
  return ids.map((id) => findNavItem(id)).filter((item): item is NavItem => item !== undefined);
}
