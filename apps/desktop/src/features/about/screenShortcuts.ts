import { isTypingTarget } from "@/shared/lib/typingTarget";
import { SHORTCUT_GROUPS, type ShortcutGroup } from "./shortcutGroups";
import type { StudioScreen } from "./shortcutSheetStore";

import { commandKey } from "@/shared/lib/platform";
export const SHORTCUT_SCREENS = ["viewer", "presentation", "pages", "studioDesign", "studioDocument", "general"] as const;
export type ShortcutScreen = (typeof SHORTCUT_SCREENS)[number];

const SCREEN_GROUPS: Record<ShortcutScreen, string[]> = {
  viewer: ["viewer", "editor", "presentation", "global"],
  presentation: ["presentation"],
  pages: ["organizer", "global"],
  studioDesign: ["studio", "global"],
  studioDocument: ["studioDocument", "global"],
  general: ["global"],
};

export function shortcutScreen(pathname: string, immersive: boolean, studio: StudioScreen): ShortcutScreen {
  if (immersive) return "presentation";
  if (pathname === "/viewer") return "viewer";
  if (pathname === "/pages") return "pages";
  if (pathname === "/studio" && studio === "design") return "studioDesign";
  if (pathname === "/studio" && studio === "document") return "studioDocument";
  return "general";
}

export function shortcutGroupsFor(screen: ShortcutScreen): ShortcutGroup[] {
  return SCREEN_GROUPS[screen].flatMap((id) => SHORTCUT_GROUPS.filter((group) => group.id === id));
}

export function isShortcutSheetKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.altKey) return false;
  if (event.key === "F1") return !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const slash = event.key === "/" || event.code === "NumpadDivide";
  return slash && commandKey(event) && !isTypingTarget(event.target);
}
