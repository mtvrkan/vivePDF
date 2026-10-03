import type { StudioElement } from "@/types/studio";
import { textOf } from "../model/design";

export function elementLabel(element: StudioElement, t: (key: string) => string): string {
  if (element.name) return element.name;
  if (element.kind === "text") return textOf(element.runs).trim().slice(0, 40) || t("studio.kinds.text");
  if (element.kind === "shape") return t(`studio.shapes.${element.shape}`);
  return t(`studio.kinds.${element.kind}`);
}
