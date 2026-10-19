import { isMac } from "@/shared/lib/platform";

type NavigationKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { code?: string };

export const FIND_AGAIN_KEYS = isMac ? "Ctrl G  /  Ctrl Shift G" : "F3  /  Shift F3";
export const HISTORY_KEYS = isMac ? "Ctrl [  /  Ctrl ]" : "Alt ←  /  Alt →";

export function findAgainKey(event: NavigationKey, mac = isMac): "next" | "previous" | null {
  const direction = event.shiftKey ? "previous" : "next";
  if (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey) return direction;
  const letterG = event.key.toLowerCase() === "g" || event.code === "KeyG";
  if (mac && letterG && event.metaKey && !event.ctrlKey && !event.altKey) return direction;
  return null;
}

export function historyKey(event: NavigationKey, mac = isMac): "back" | "forward" | null {
  if (event.shiftKey) return null;
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === "ArrowLeft") return "back";
    if (event.key === "ArrowRight") return "forward";
  }
  if (mac && event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === "[" || event.code === "BracketLeft") return "back";
    if (event.key === "]" || event.code === "BracketRight") return "forward";
  }
  return null;
}
