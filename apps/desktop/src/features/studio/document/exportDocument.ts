import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioRenderDocument } from "@/shared/rpc/operations";
import { documentContent, type DocumentText } from "./content";
import { useDocumentStore } from "./documentStore";

export type DocumentExportParams = { output: string; overwrite?: boolean; language: string; text: DocumentText };

export async function exportDocument(params: DocumentExportParams, options?: RpcCallOptions) {
  const document = useDocumentStore.getState().document;
  if (!document) throw new Error("no document");
  return studioRenderDocument({ ...documentContent(document, params.language, params.text), output: params.output, overwrite: params.overwrite }, options);
}
