import type { StudioElement } from "@/types/studio";
import { textOf } from "../model/design";

export { claimSystemPaste, clipboardImages, expectSystemPaste, PASTE_WAIT_MS } from "@/shared/lib/systemPaste";

export function copiedText(elements: readonly StudioElement[]): string {
  return elements
    .filter((element) => element.kind === "text")
    .map((element) => (element.kind === "text" ? textOf(element.runs) : ""))
    .join("\n");
}

export function replaceSystemClipboard(elements: readonly StudioElement[]) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) return;
  clipboard.writeText(copiedText(elements)).catch(() => undefined);
}
