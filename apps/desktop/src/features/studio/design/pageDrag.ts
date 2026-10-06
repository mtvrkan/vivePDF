import type { RefObject } from "react";
import type { StudioPage } from "@/types/studio";
import { movePage } from "../model/pages";
import { moveIndex, useDragSort, type DropSide } from "./dragSort";
import { useStudioStore } from "./studioStore";

export const PAGE_DROP_ATTRIBUTE = "data-page-drop";

export type PageDrop = { key: string; side: DropSide; index: number };

export function pageLabel(t: (key: string, options?: Record<string, unknown>) => string, page: Pick<StudioPage, "name">, number: number): string {
  return page.name ? t("studio.pages.pageNamed", { number, name: page.name }) : t("studio.pages.page", { number });
}

export function usePageDrag(container: RefObject<HTMLElement | null>) {
  return useDragSort<string, PageDrop>({
    attribute: PAGE_DROP_ATTRIBUTE,
    axis: "x",
    container,
    resolve: (pageId, probe) => {
      const pages = useStudioStore.getState().design?.pages ?? [];
      const from = pages.findIndex((page) => page.id === pageId);
      const target = pages.findIndex((page) => page.id === probe.key);
      if (from < 0 || target < 0) return null;
      const index = moveIndex(from, target, probe.side);
      return index === null ? null : { key: probe.key, side: probe.side, index };
    },
    drop: (pageId, target) => useStudioStore.getState().apply((design) => movePage(design, pageId, target.index)),
  });
}
