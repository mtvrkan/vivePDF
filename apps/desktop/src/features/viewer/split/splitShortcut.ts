import { commandKey } from "@/shared/lib/platform";

export function isSplitViewToggle(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key">): boolean {
  return commandKey(event) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "e";
}
