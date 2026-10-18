import { afterEach, describe, expect, it, vi } from "vitest";
import { studioExportMarkdown, studioRenderDocument } from "@/shared/rpc/operations";
import type { DocumentNode } from "@/types/studio";
import { useDocumentStore } from "./documentStore";
import { exportDocument, withExportExtension } from "./exportDocument";
import { createDocument } from "./model";

vi.mock("@/shared/rpc/operations", () => ({
  studioExportMarkdown: vi.fn(async (params: { output: string }) => ({ output: params.output, bytes: 12 })),
  studioRenderDocument: vi.fn(async (params: { output: string }) => ({ output: params.output, pageCount: 3, bytes: 900 })),
}));

const TEXT = { tocTitle: "Contents", referencesTitle: "References", notesTitle: "Notes", terms: { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" } };

afterEach(() => {
  vi.mocked(studioExportMarkdown).mockClear();
  vi.mocked(studioRenderDocument).mockClear();
  useDocumentStore.setState({ document: null });
  localStorage.clear();
});

describe("exportDocument", () => {
  it("writes Markdown with the document content and reports no page count", async () => {
    const content: DocumentNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Claim" }, { type: "footnote", attrs: { text: "x2", html: "x<sub>2</sub>" } }] }] };
    useDocumentStore.getState().open(createDocument("Talk", content));

    const result = await exportDocument({ output: "C:/out/Talk.md", language: "en", text: TEXT, format: "markdown", overwrite: true });

    expect(result).toEqual({ output: "C:/out/Talk.md", pageCount: null });
    expect(studioRenderDocument).not.toHaveBeenCalled();
    const params = vi.mocked(studioExportMarkdown).mock.calls[0]?.[0];
    expect(params).toMatchObject({ output: "C:/out/Talk.md", overwrite: true, footnotes: ["x2"], footnoteHtml: ["x<sub>2</sub>"] });
    expect(params?.html).toContain('<sup class="fn-ref" id="fnref-1">1</sup>');
  });

  it("renders a PDF by default and passes its page count on", async () => {
    useDocumentStore.getState().open(createDocument("Talk", "<p>x</p>"));

    const result = await exportDocument({ output: "C:/out/Talk.pdf", language: "en", text: TEXT });

    expect(result).toEqual({ output: "C:/out/Talk.pdf", pageCount: 3 });
    expect(studioExportMarkdown).not.toHaveBeenCalled();
  });

  it("exports the words typed just before, still waiting to reach the document", async () => {
    useDocumentStore.getState().open(createDocument("Talk", "<p>x</p>"));
    useDocumentStore.getState().deferContent(() => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Last words" }] }] }));

    await exportDocument({ output: "C:/out/Talk.md", language: "en", text: TEXT, format: "markdown" });

    expect(vi.mocked(studioExportMarkdown).mock.calls[0]?.[0].html).toContain("Last words");
  });

  it("refuses to export without an open document", async () => {
    await expect(exportDocument({ output: "C:/out/x.md", language: "en", text: TEXT, format: "markdown" })).rejects.toThrow("no document");
  });

  it("swaps the file extension for the chosen format", () => {
    expect(withExportExtension("C:/out/Talk.pdf", "markdown")).toBe("C:/out/Talk.md");
    expect(withExportExtension("C:/out/Talk.markdown", "pdf")).toBe("C:/out/Talk.pdf");
    expect(withExportExtension("C:/out/Talk.v2", "markdown")).toBe("C:/out/Talk.v2.md");
  });
});
