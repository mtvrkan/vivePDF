import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioExportDocx, studioExportMarkdown, studioRenderDocument } from "@/shared/rpc/operations";
import { documentContent, wordContent, type DocumentText } from "./content";
import { useDocumentStore } from "./documentStore";

export const DOCUMENT_EXPORT_FORMATS = ["pdf", "word", "markdown"] as const;

export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export type DocumentExportParams = { output: string; overwrite?: boolean; language: string; text: DocumentText; format?: DocumentExportFormat };

export type DocumentExportResult = { output: string; pageCount: number | null };

export const EXPORT_EXTENSIONS: Record<DocumentExportFormat, string> = { pdf: "pdf", word: "docx", markdown: "md" };

export function withExportExtension(path: string, format: DocumentExportFormat): string {
  return path.replace(/\.(pdf|docx|md|markdown)$/i, "") + `.${EXPORT_EXTENSIONS[format]}`;
}

export async function exportDocument(params: DocumentExportParams, options?: RpcCallOptions): Promise<DocumentExportResult> {
  useDocumentStore.getState().flushContent();
  const document = useDocumentStore.getState().document;
  if (!document) throw new Error("no document");
  const target = { output: params.output, overwrite: params.overwrite };
  if (params.format === "word") {
    const written = await studioExportDocx({ ...(await wordContent(document, params.language, params.text)), ...target }, options);
    return { output: written.output, pageCount: null };
  }
  const content = { ...(await documentContent(document, params.language, params.text)), ...target };
  if (params.format === "markdown") {
    const written = await studioExportMarkdown(content, options);
    return { output: written.output, pageCount: null };
  }
  const rendered = await studioRenderDocument(content, options);
  return { output: rendered.output, pageCount: rendered.pageCount };
}
