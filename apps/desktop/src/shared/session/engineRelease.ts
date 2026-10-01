import * as logger from "@/shared/lib/logger";
import { releaseDocuments } from "@/shared/rpc/documents";
import { useDocumentStore } from "@/shared/store/documentStore";

function openPaths(): Set<string> {
  return new Set(Object.values(useDocumentStore.getState().documents).map((doc) => doc.path));
}

function release(path?: string) {
  releaseDocuments(path === undefined ? {} : { path }).catch((error: unknown) => logger.warn("engine.release", String(error)));
}

export function releaseClosedDocuments(): () => void {
  let previous = openPaths();
  return useDocumentStore.subscribe(() => {
    const current = openPaths();
    if (current.size === 0 && previous.size > 0) release();
    else for (const path of previous) if (!current.has(path)) release(path);
    previous = current;
  });
}
