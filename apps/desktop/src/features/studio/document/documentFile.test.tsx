import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import i18n, { ready, setLocale } from "@/app/i18n";
import { citationTerms, storeCitationSource } from "./citationSource";
import { importedDocument, openSourceLibrary, saveStudioDocument } from "./documentFile";
import { useDocumentStore } from "./documentStore";
import { documentExtensions } from "./extensions";

const IMPORTED = {
  html: '<h1>Giriş</h1><p>Isı artıyor <span data-citation="[{&quot;key&quot;:&quot;yilmaz2020&quot;,&quot;locator&quot;:&quot;4&quot;}]"></span>.</p><div data-bibliography=""></div>',
  title: "Kent Isısı",
  author: "Ayşe Yılmaz",
  date: "2026",
  referencesTitle: "Kaynakça",
  bibliography: "@article{yilmaz2020, author={Y{\\i}lmaz, Ay{\\c{s}}e}, title={Kentsel ısı}, journal={Kent}, year=2020}",
};

const operations = vi.hoisted(() => ({ studioReadBibliography: vi.fn(), studioSaveDocument: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => operations);
const saveDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: (...args: unknown[]) => saveDialog(...args) }));

let editor: Editor | null = null;

describe("importedDocument", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("carries the title, authors, reference heading and bibliography into the new document", () => {
    const document = importedDocument(IMPORTED);

    expect(document.name).toBe("Kent Isısı");
    expect(document.settings).toMatchObject({ author: "Ayşe Yılmaz", date: "2026", referencesTitle: "Kaynakça" });
    expect(document.sources.map((entry) => entry.key)).toEqual(["yilmaz2020"]);
    expect(document.sources[0].authors).toEqual([{ family: "Yılmaz", given: "Ayşe" }]);
  });

  it("turns the imported citation and reference list markup into live editor nodes", () => {
    useDocumentStore.getState().open(importedDocument(IMPORTED));

    editor = new Editor({ extensions: documentExtensions("", storeCitationSource(citationTerms(i18n.t), "en", "References", "")), content: IMPORTED.html });

    expect(editor.view.dom.querySelector(".vp-cite")?.textContent).toBe("(Yılmaz, 2020, p. 4)");
    expect(editor.view.dom.querySelector(".vp-refs h1")?.textContent).toBe("Kaynakça");
    expect(editor.view.dom.querySelector(".vp-ref")?.textContent).toBe("Yılmaz, A. (2020). Kentsel ısı. Kent.");
  });

  it("leaves sources empty when the file came without a bibliography", () => {
    expect(importedDocument({ ...IMPORTED, bibliography: "" }).sources).toEqual([]);
  });
});

describe("openSourceLibrary", () => {
  it("turns a RIS file into a new document that lists every source", async () => {
    operations.studioReadBibliography.mockResolvedValueOnce({ text: "TY  - JOUR\nAU  - Lee, Min\nTI  - Urban heat\nPY  - 2019\nER  - \n", name: "zotero.ris" });

    const document = await openSourceLibrary("C:/refs/zotero.ris");

    expect(operations.studioReadBibliography.mock.calls[0][0]).toEqual({ path: "C:/refs/zotero.ris" });
    expect(document?.name).toBe("zotero");
    expect(document?.content).toBe('<div data-bibliography=""></div>');
    expect(document?.sources.map((entry) => [entry.key, entry.fields.title])).toEqual([["lee2019urban", "Urban heat"]]);
  });

  it("gives nothing back for a library without entries", async () => {
    operations.studioReadBibliography.mockResolvedValueOnce({ text: "% empty", name: "empty.bib" });

    expect(await openSourceLibrary("C:/refs/empty.bib")).toBeNull();
  });
});

describe("saveStudioDocument", () => {
  const options = { saveAs: false, fallbackName: "Document", filterName: "vivePDF document" };
  const notGranted = { code: "PERMISSION_DENIED", message: "C:/docs/thesis.vivedoc was not opened through vivePDF", data: { reason: "notGranted" } };

  afterEach(() => {
    operations.studioSaveDocument.mockReset();
    saveDialog.mockReset();
  });

  it("saves in place without asking when the file may be written", async () => {
    useDocumentStore.getState().open(importedDocument(IMPORTED), "C:/docs/thesis.vivedoc");
    operations.studioSaveDocument.mockResolvedValueOnce({ output: "C:/docs/thesis.vivedoc", bytes: 10 });

    const saved = await saveStudioDocument(options);

    expect(saved).toBe("C:/docs/thesis.vivedoc");
    expect(saveDialog).not.toHaveBeenCalled();
  });

  it("asks for the same path when an in-place save is not granted and saves where the user confirms", async () => {
    useDocumentStore.getState().open(importedDocument(IMPORTED), "C:/docs/thesis.vivedoc");
    operations.studioSaveDocument.mockRejectedValueOnce(notGranted).mockResolvedValueOnce({ output: "C:/docs/thesis.vivedoc", bytes: 10 });
    saveDialog.mockResolvedValueOnce("C:/docs/thesis.vivedoc");

    const saved = await saveStudioDocument(options);

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:/docs/thesis.vivedoc" }));
    expect(operations.studioSaveDocument).toHaveBeenCalledTimes(2);
    expect(saved).toBe("C:/docs/thesis.vivedoc");
  });

  it("gives up quietly when the user cancels, and passes other failures on", async () => {
    useDocumentStore.getState().open(importedDocument(IMPORTED), "C:/docs/thesis.vivedoc");
    operations.studioSaveDocument.mockRejectedValueOnce(notGranted).mockRejectedValueOnce({ code: "DISK_FULL", message: "full" });
    saveDialog.mockResolvedValueOnce(null);

    await expect(saveStudioDocument(options)).resolves.toBeNull();
    await expect(saveStudioDocument(options)).rejects.toMatchObject({ code: "DISK_FULL" });
    expect(saveDialog).toHaveBeenCalledTimes(1);
  });
});
