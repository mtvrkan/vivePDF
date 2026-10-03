import { useCallback } from "react";
import { sessionPathOf } from "@/features/viewer/convertedDocuments";
import { groupedOrder, useTabGroupStore } from "@/features/viewer/tabGroups";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { pathKey } from "@/shared/lib/paths";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { Collection } from "./collectionsStore";

export function collectionDocumentIds(collection: Collection): string[] {
  const { documents, order } = useDocumentStore.getState();
  const wanted = new Set(collection.paths.map(pathKey));
  return order.filter((id) => {
    const document = documents[id];
    return document !== undefined && wanted.has(pathKey(sessionPathOf(document.path)));
  });
}

export function groupCollectionTabs(collection: Collection) {
  const ids = collectionDocumentIds(collection);
  if (ids.length < 2) return;
  const tabGroups = useTabGroupStore.getState();
  const groupId = tabGroups.create(ids);
  tabGroups.rename(groupId, collection.name);
  tabGroups.recolor(groupId, collection.color);
  const { order } = useDocumentStore.getState();
  useDocumentStore.setState({ order: groupedOrder(order, useTabGroupStore.getState().memberOf) });
}

export function useOpenCollection() {
  const { openPaths } = useOpenPdf();
  return useCallback(
    async (collection: Collection) => {
      await openPaths(collection.paths);
      groupCollectionTabs(collection);
    },
    [openPaths],
  );
}
