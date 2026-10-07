import { createBlobCache } from "@/shared/lib/blobCache";

export const thumbnails = createBlobCache(600);

export function forgetDocumentThumbnails(documentId: string): number {
  return thumbnails.forget(`${documentId}:`);
}
