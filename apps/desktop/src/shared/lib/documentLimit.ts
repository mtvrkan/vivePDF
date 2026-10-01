import type { RpcError } from "@/types";

export const MAX_OPEN_DOCUMENTS = 20;

export function documentRoomError(openCount: number, needed = 1): RpcError | null {
  if (openCount + needed <= MAX_OPEN_DOCUMENTS) return null;
  return { code: "UNSUPPORTED", message: "too many documents are open", data: { reason: "tooManyDocuments", max: MAX_OPEN_DOCUMENTS } };
}
