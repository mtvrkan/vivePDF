import type { StudioDropShadow, StudioElement } from "@/types/studio";
import { num } from "../model/shapes";

export function shadowOf(element: StudioElement): StudioDropShadow | null {
  return element.kind === "text" ? null : element.dropShadow;
}

export function localShadowOffset(shadow: Pick<StudioDropShadow, "x" | "y">, rotation: number): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: shadow.x * cos + shadow.y * sin, y: -shadow.x * sin + shadow.y * cos };
}

function rgba(color: string, alpha: number): string {
  const channel = (index: number) => parseInt(color.slice(index, index + 2), 16);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${num(alpha)})`;
}

export function dropShadowFilter(element: StudioElement): string | undefined {
  const shadow = shadowOf(element);
  if (!shadow || shadow.opacity <= 0) return undefined;
  const turned = localShadowOffset(shadow, element.rotation);
  const offset = { x: element.flipX ? -turned.x : turned.x, y: element.flipY ? -turned.y : turned.y };
  return `drop-shadow(${num(offset.x)}px ${num(offset.y)}px ${num(shadow.blur)}px ${rgba(shadow.color, shadow.opacity)})`;
}
