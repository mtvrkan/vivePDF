import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sessionPathOf } from "@/features/viewer/convertedDocuments";
import { groupedOrder, useTabGroupStore } from "@/features/viewer/tabGroups";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { pathKey } from "@/shared/lib/paths";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useOpenStore } from "@/shared/store/openStore";
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
  const existing = tabGroups.groups.find((group) => group.name === collection.name && ids.some((id) => tabGroups.memberOf[id] === group.id));
  if (existing) {
    for (const id of ids) if (!tabGroups.memberOf[id]) tabGroups.join(id, existing.id);
  } else {
    const groupId = tabGroups.create(ids);
    tabGroups.rename(groupId, collection.name);
    tabGroups.recolor(groupId, collection.color);
  }
  const { order } = useDocumentStore.getState();
  useDocumentStore.setState({ order: groupedOrder(order, useTabGroupStore.getState().memberOf) });
}

async function existingPaths(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const exists = await invoke<boolean[]>("path_exists", { paths }).catch(() => paths.map(() => true));
  return paths.filter((_, index) => exists[index]);
}

export function useOpenCollection() {
  const { openPaths } = useOpenPdf();
  return useCallback(
    async (collection: Collection): Promise<boolean> => {
      const paths = await existingPaths(collection.paths);
      if (paths.length === 0) return false;
      await openPaths(paths);
      groupCollectionTabs(collection);
      const open = useOpenStore.getState();
      if (open.waitingPaths.length > 0) open.setAfterWaiting(() => groupCollectionTabs(collection));
      return true;
    },
    [openPaths],
  );
}
