export function layerKey(pageIndex: number, id: string): string {
  return `${pageIndex}:${id}`;
}

export function imagePreviewKey(documentId: string, pageIndex: number, xref: number): string {
  return `${documentId}:${pageIndex}:${xref}`;
}

export function isLayerLocked(lockedLayerKeys: Record<string, true>, pageIndex: number, id: string): boolean {
  return Boolean(lockedLayerKeys[layerKey(pageIndex, id)]);
}
