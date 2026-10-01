import { createBlobCache } from "@/shared/lib/blobCache";

export const thumbnails = createBlobCache(240);

export function forgetDocumentThumbnails(documentId: string): number {
  return thumbnails.forget(`${documentId}:`);
}
