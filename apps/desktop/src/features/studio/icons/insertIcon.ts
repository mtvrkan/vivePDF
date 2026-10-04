import { createVector } from "../model/design";
import { centred, insert } from "../design/insert";
import { currentPage, useStudioStore } from "../design/studioStore";
import type { IconArt } from "./iconArt";
import type { IconEntry } from "./iconSearch";

export const DEFAULT_ICON_COLOR = "#1f2937";
export const ICON_PAGE_SHARE = 0.2;

export function insertIcon(entry: IconEntry, paint: (color: string) => IconArt | null) {
  const state = useStudioStore.getState();
  const page = currentPage(state);
  if (!page) return;
  const side = Math.round(Math.min(page.width, page.height) * ICON_PAGE_SHARE);
  const at = centred(page, side, side);
  const art = paint(state.design?.palette[0] ?? DEFAULT_ICON_COLOR);
  if (art) insert(createVector(art, at.x, at.y, side, side, entry.label));
}
