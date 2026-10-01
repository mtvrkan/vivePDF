import type { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { openViewSource, readDocumentBytes, releaseViewSource, viewSourceUrl } from "@/shared/rpc/files";
import { useDocumentStore } from "@/shared/store/documentStore";

export type ViewableSource = { kind: "buffer"; buffer: ArrayBuffer } | { kind: "range"; url: string; token: string };

export type ViewableFile = { name: string; documentId: string; password?: string; autoActivate?: boolean };

type DocumentManager = NonNullable<ReturnType<typeof useDocumentManagerCapability>["provides"]>;

const tokens = new Map<string, string>();

export function attachViewSource(documentId: string, token: string) {
  tokens.set(documentId, token);
}

export function releaseViewSourceOf(documentId: string) {
  const token = tokens.get(documentId);
  if (token === undefined) return;
  tokens.delete(documentId);
  void releaseViewSource(token);
}

export function releaseClosedViewSources(): () => void {
  let previous = new Set(Object.keys(useDocumentStore.getState().documents));
  return useDocumentStore.subscribe((state) => {
    const current = new Set(Object.keys(state.documents));
    for (const documentId of previous) if (!current.has(documentId)) releaseViewSourceOf(documentId);
    previous = current;
  });
}

async function reachable(url: string): Promise<boolean> {
  return fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" }).then(
    (response) => response.status === 206,
    () => false,
  );
}

export async function rangeSource(path: string): Promise<ViewableSource | null> {
  const view = await openViewSource(path).catch(() => null);
  if (!view) return null;
  const url = viewSourceUrl(view.token);
  if (await reachable(url)) return { kind: "range", url, token: view.token };
  await releaseViewSource(view.token);
  return null;
}

export async function readOriginalSource(path: string): Promise<ViewableSource> {
  return (await rangeSource(path)) ?? { kind: "buffer", buffer: await readDocumentBytes(path) };
}

export async function openViewable(docManager: DocumentManager, source: ViewableSource, file: ViewableFile): Promise<void> {
  if (source.kind === "range") attachViewSource(file.documentId, source.token);
  const response = await (source.kind === "range"
    ? docManager.openDocumentUrl({ url: source.url, mode: "range-request", ...file })
    : docManager.openDocumentBuffer({ buffer: source.buffer, ...file })
  ).toPromise();
  await response.task.toPromise();
}

export function closeViewable(docManager: DocumentManager, documentId: string): void {
  if (docManager.isDocumentOpen(documentId)) docManager.closeDocument(documentId).wait(() => undefined, () => undefined);
  releaseViewSourceOf(documentId);
}
