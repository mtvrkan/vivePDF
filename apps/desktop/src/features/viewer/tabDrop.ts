import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openDocumentAt } from "@/shared/session/documentClaims";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { DroppedTabGroup, TabDropEvent } from "@/types";
import { isOverStrip } from "./tabTearOff";
import { groupAfterMove, groupedOrder, isGroupColor, useTabGroupStore } from "./tabGroups";

export const DOCUMENT_TABS_SELECTOR = "[data-document-tabs]";
export const DRAG_HOVER_MS = 33;

type Area = Pick<TabDropEvent, "x" | "y" | "width" | "height">;

export function dropPoint(area: Area, innerWidth: number, innerHeight: number): { x: number; y: number } {
  const scaleX = area.width > 0 ? innerWidth / area.width : 1;
  const scaleY = area.height > 0 ? innerHeight / area.height : 1;
  return { x: area.x * scaleX, y: area.y * scaleY };
}

export function tabBefore(strip: HTMLElement | null, x: number, y: number): string | null {
  if (!strip || !isOverStrip(y, strip.getBoundingClientRect())) return null;
  const next = stripTabs(strip).find((tab) => {
    const rect = tab.getBoundingClientRect();
    return rect.left + rect.width / 2 > x;
  });
  return next?.dataset.tabId ?? null;
}

function stripTabs(strip: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"][data-tab-id]'));
}

export function dropLineAt(strip: HTMLElement | null, x: number, y: number): number | null {
  if (!strip) return null;
  const box = strip.getBoundingClientRect();
  if (!isOverStrip(y, box)) return null;
  const tabs = stripTabs(strip);
  const beforeId = tabBefore(strip, x, y);
  const next = tabs.find((tab) => tab.dataset.tabId === beforeId);
  const edge = next ? next.getBoundingClientRect().left : (tabs[tabs.length - 1]?.getBoundingClientRect().right ?? box.left);
  return edge - box.left;
}

export function createDragHover(send: (active: boolean) => void, now: () => number = () => performance.now()) {
  let outside = false;
  let last = Number.NEGATIVE_INFINITY;
  return {
    move(isOutside: boolean) {
      if (!isOutside) {
        if (!outside) return;
        outside = false;
        send(false);
        return;
      }
      const time = now();
      if (outside && time - last < DRAG_HOVER_MS) return;
      outside = true;
      last = time;
      send(true);
    },
    end() {
      if (!outside) return;
      outside = false;
      send(false);
    },
  };
}

export type DragHover = ReturnType<typeof createDragHover>;

export function placeDroppedTabs(ids: string[], beforeId: string | null, group: DroppedTabGroup | null) {
  for (const id of ids) {
    const rest = useDocumentStore.getState().order.filter((entry) => entry !== id);
    const anchor = beforeId ? rest.indexOf(beforeId) : -1;
    useDocumentStore.getState().move(id, anchor >= 0 ? anchor : rest.length);
  }
  const tabGroups = useTabGroupStore.getState();
  if (group && ids.length > 0) {
    const created = tabGroups.create(ids);
    tabGroups.rename(created, group.name);
    if (isGroupColor(group.color)) tabGroups.recolor(created, group.color);
    tabGroups.setCollapsed(created, group.collapsed);
  } else {
    for (const id of ids) {
      const target = groupAfterMove(useDocumentStore.getState().order, id, useTabGroupStore.getState().memberOf);
      if (target) tabGroups.join(id, target);
      else tabGroups.leave(id);
    }
  }
  useDocumentStore.setState({ order: groupedOrder(useDocumentStore.getState().order, useTabGroupStore.getState().memberOf) });
}

export function useTabDropListener(openPaths: (paths: string[]) => Promise<void>) {
  const openRef = useRef(openPaths);
  openRef.current = openPaths;

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<TabDropEvent>("tab-drop", (event) => {
      const { paths, group } = event.payload;
      const point = dropPoint(event.payload, window.innerWidth, window.innerHeight);
      const beforeId = tabBefore(document.querySelector<HTMLElement>(DOCUMENT_TABS_SELECTOR), point.x, point.y);
      void openRef.current(paths).then(() => {
        const ids = paths.map((path) => openDocumentAt(path)?.id).filter((id): id is string => !!id);
        placeDroppedTabs(ids, beforeId, group);
      });
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
}

export function useRemoteDropLine(strip: () => HTMLElement | null): number | null {
  const [line, setLine] = useState<number | null>(null);
  const stripRef = useRef(strip);
  stripRef.current = strip;

  useEffect(() => {
    const view = getCurrentWebviewWindow();
    const stops = [
      view.listen<Area>("tab-drag-over", (event) => {
        const point = dropPoint(event.payload, window.innerWidth, window.innerHeight);
        setLine(dropLineAt(stripRef.current(), point.x, point.y));
      }),
      view.listen("tab-drag-leave", () => setLine(null)),
      view.listen("tab-drop", () => setLine(null)),
    ];
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, []);

  return line;
}
