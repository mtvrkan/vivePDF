import { commandKey, isMac } from "@/shared/lib/platform";

type FindKey = Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export const FIND_REPLACE_KEYS = isMac ? "Ctrl F  /  Ctrl Alt F" : "Ctrl F  /  Ctrl H";

export function findShortcut(event: FindKey, letter: string | null, mac = isMac): "find" | "replace" | null {
  if (!commandKey(event, mac) || event.shiftKey) return null;
  if (letter === "f") return !event.altKey ? "find" : mac ? "replace" : null;
  if (letter === "h" && !mac && !event.altKey) return "replace";
  return null;
}
