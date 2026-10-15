import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioExportMarkdown, studioRenderDocument } from "@/shared/rpc/operations";
import { documentContent, type DocumentText } from "./content";
import { useDocumentStore } from "./documentStore";

export const DOCUMENT_EXPORT_FORMATS = ["pdf", "markdown"] as const;

export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export type DocumentExportParams = { output: string; overwrite?: boolean; language: string; text: DocumentText; format?: DocumentExportFormat };

export type DocumentExportResult = { output: string; pageCount: number | null };

export const EXPORT_EXTENSIONS: Record<DocumentExportFormat, string> = { pdf: "pdf", markdown: "md" };

export function withExportExtension(path: string, format: DocumentExportFormat): string {
  return path.replace(/\.(pdf|md|markdown)$/i, "") + `.${EXPORT_EXTENSIONS[format]}`;
}

export async function exportDocument(params: DocumentExportParams, options?: RpcCallOptions): Promise<DocumentExportResult> {
  const document = useDocumentStore.getState().document;
  if (!document) throw new Error("no document");
  const content = { ...documentContent(document, params.language, params.text), output: params.output, overwrite: params.overwrite };
  if (params.format === "markdown") {
    const written = await studioExportMarkdown(content, options);
    return { output: written.output, pageCount: null };
  }
  const rendered = await studioRenderDocument(content, options);
  return { output: rendered.output, pageCount: rendered.pageCount };
}
