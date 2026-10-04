import { createVector } from "../model/design";
import { centred, insert } from "../design/insert";
import { currentPage, useStudioStore } from "../design/studioStore";
import { iconArt, type IconNode } from "./iconArt";
import type { IconEntry } from "./iconSearch";

export const DEFAULT_ICON_COLOR = "#1f2937";
export const ICON_PAGE_SHARE = 0.2;

export function insertIcon(entry: IconEntry, node: IconNode) {
  const state = useStudioStore.getState();
  const page = currentPage(state);
  if (!page) return;
  const side = Math.round(Math.min(page.width, page.height) * ICON_PAGE_SHARE);
  const at = centred(page, side, side);
  insert(createVector(iconArt(node, state.design?.palette[0] ?? DEFAULT_ICON_COLOR), at.x, at.y, side, side, entry.label));
}
