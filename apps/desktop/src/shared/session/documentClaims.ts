import { pathKey } from "@/shared/lib/paths";
import { shareOpenDocumentPaths } from "@/shared/rpc/files";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { OpenDocument } from "@/types";

function openPaths(): string[] {
  return [...new Set(Object.values(useDocumentStore.getState().documents).map((doc) => doc.path))].sort();
}

export function shareOpenDocuments(): () => void {
  let shared: string | null = null;
  const share = () => {
    const paths = openPaths();
    const key = paths.join("\n");
    if (key === shared) return;
    shared = key;
    void shareOpenDocumentPaths(paths);
  };
  share();
  return useDocumentStore.subscribe(share);
}

export function openDocumentAt(path: string): OpenDocument | null {
  const wanted = pathKey(path);
  return Object.values(useDocumentStore.getState().documents).find((doc) => pathKey(doc.path) === wanted) ?? null;
}
