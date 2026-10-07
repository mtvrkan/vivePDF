import { useDocumentStore } from "@/shared/store/documentStore";
import { useTabGroupStore } from "./tabGroups";

export type TabPlace = { index: number; groupId: string | null };

export function tabPlaceOf(documentId: string): TabPlace | null {
  const index = useDocumentStore.getState().order.indexOf(documentId);
  if (index < 0) return null;
  return { index, groupId: useTabGroupStore.getState().memberOf[documentId] ?? null };
}

export function restoreTabPlace(documentId: string, place: TabPlace | null) {
  if (!place) return;
  useDocumentStore.getState().move(documentId, place.index);
  const groups = useTabGroupStore.getState();
  if (place.groupId && groups.groups.some((group) => group.id === place.groupId)) groups.join(documentId, place.groupId);
}

export function neighbourAfterClose(order: string[], closedId: string, open: string[]): string | null {
  const live = new Set(open.filter((id) => id !== closedId));
  if (live.size === 0) return null;
  const index = order.indexOf(closedId);
  if (index >= 0) {
    const after = order.slice(index + 1).find((id) => live.has(id));
    if (after) return after;
    const before = order.slice(0, index).reverse().find((id) => live.has(id));
    if (before) return before;
  }
  return order.find((id) => live.has(id)) ?? [...live][0];
}
