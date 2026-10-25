import { stemOf } from "@/shared/lib/paths";
import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioRenderDocument } from "@/shared/rpc/operations";
import type { OutputResult, RpcError } from "@/types";
import type { DocumentPaper } from "@/types/studio";
import { BIBLIOGRAPHY } from "./citationItems";
import { documentContent, type DocumentText } from "./content";
import { readSourceLibrary } from "./documentFile";
import { createDocument } from "./model";

export type SourceLibraryPdfParams = { output: string; overwrite?: boolean; paper?: DocumentPaper; language: string; text: DocumentText };

export async function sourceLibraryToPdf(path: string, params: SourceLibraryPdfParams, options?: RpcCallOptions): Promise<OutputResult> {
  const sources = await readSourceLibrary(path, options);
  if (sources.length === 0) throw { code: "INVALID_PARAMS", message: "the file holds no sources", data: { reason: "noSources" } } satisfies RpcError;
  const document = { ...createDocument(stemOf(path), { type: "doc", content: [{ type: BIBLIOGRAPHY }] }, params.paper ? { paper: params.paper } : {}), sources };
  return studioRenderDocument({ ...(await documentContent(document, params.language, params.text)), output: params.output, overwrite: params.overwrite }, options);
}
