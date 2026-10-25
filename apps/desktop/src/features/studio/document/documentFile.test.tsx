import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { importedDocument, openSourceLibrary, openSourceLibraryFile, saveSourceLibrary, saveStudioDocument } from "./documentFile";
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

const operations = vi.hoisted(() => ({ studioReadBibliography: vi.fn(), studioSaveDocument: vi.fn(), studioWriteBibliography: vi.fn() }));
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

    editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: IMPORTED.html });

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

describe("saveSourceLibrary", () => {
  const LIBRARY = "% my thesis\n@article{first,\n  title = {First},\n  year  = 2001\n}\n\n@book{second,\n  title = {Second},\n  year  = 2002\n}\n";
  const read = (text = LIBRARY, extra: Record<string, unknown> = {}) => ({ text, name: "thesis.bib", encoding: "cp1254", hash: "h1", lossy: false, ...extra });
  const notGranted = { code: "PERMISSION_DENIED", message: "read only", data: { reason: "notGranted" } };

  async function openLibrary(path = "C:/refs/thesis.bib", text = LIBRARY) {
    operations.studioReadBibliography.mockResolvedValueOnce(read(text));
    const opened = await openSourceLibraryFile(path);
    if (!opened) throw new Error("not opened");
    useDocumentStore.getState().open(opened.document, null, opened.origin);
    return opened;
  }

  afterEach(() => {
    operations.studioReadBibliography.mockReset();
    operations.studioWriteBibliography.mockReset();
    saveDialog.mockReset();
  });

  it("writes only the edited entry back into the opened file in its own encoding", async () => {
    const opened = await openLibrary();
    useDocumentStore.getState().setSources(opened.document.sources.map((entry) => (entry.key === "second" ? { ...entry, fields: { ...entry.fields, year: "2003" } } : entry)));
    operations.studioReadBibliography.mockResolvedValueOnce(read());
    operations.studioWriteBibliography.mockResolvedValueOnce({ output: "C:/refs/thesis.bib", bytes: 10, hash: "h2" });

    const saved = await saveSourceLibrary("BibTeX");

    expect(saved).toBe("C:/refs/thesis.bib");
    expect(operations.studioWriteBibliography.mock.calls[0][0]).toEqual({ text: LIBRARY.replace("year  = 2002", "year = {2003}"), output: "C:/refs/thesis.bib", encoding: "cp1254", expectedHash: "h1", overwrite: true });
    expect(useDocumentStore.getState()).toMatchObject({ dirty: false, filePath: null, sourceFile: { path: "C:/refs/thesis.bib", hash: "h2", format: "bibtex" } });
  });

  it("refuses to overwrite a file that another program changed after it was opened", async () => {
    await openLibrary();
    operations.studioReadBibliography.mockResolvedValueOnce(read(LIBRARY + "\n", { hash: "other" }));

    await expect(saveSourceLibrary("BibTeX")).rejects.toMatchObject({ data: { reason: "sourceChangedOnDisk", name: "thesis.bib" } });
    expect(operations.studioWriteBibliography).not.toHaveBeenCalled();
  });

  it("refuses an in-place save of a BibTeX file that was read with replaced characters", async () => {
    operations.studioReadBibliography.mockResolvedValueOnce(read(LIBRARY, { lossy: true }));
    const opened = await openSourceLibraryFile("C:/refs/thesis.bib");
    useDocumentStore.getState().open(opened?.document ?? importedDocument(IMPORTED), null, opened?.origin);

    await expect(saveSourceLibrary("BibTeX")).rejects.toMatchObject({ data: { reason: "sourceSaveUnsafe", name: "thesis.bib" } });
    expect(operations.studioWriteBibliography).not.toHaveBeenCalled();
  });

  it("does not tie a RIS library to its file, since RIS cannot be written back without loss", async () => {
    await openLibrary("C:/refs/zotero.ris", "TY  - JOUR\nTI  - Kept\nER  - \n");

    expect(useDocumentStore.getState().sourceFile).toBeNull();
    await expect(saveSourceLibrary("RIS")).resolves.toBeNull();
  });

  it("asks where to save when the opened file may not be written and saves there without the disk check", async () => {
    await openLibrary();
    operations.studioReadBibliography.mockResolvedValueOnce(read());
    operations.studioWriteBibliography.mockRejectedValueOnce(notGranted).mockResolvedValueOnce({ output: "C:/copy/thesis.bib", bytes: 10, hash: "h3" });
    saveDialog.mockResolvedValueOnce("C:/copy/thesis.bib");

    const saved = await saveSourceLibrary("BibTeX");

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:/refs/thesis.bib", filters: [{ name: "BibTeX", extensions: ["bib"] }] }));
    expect(operations.studioWriteBibliography.mock.calls[1][0]).toMatchObject({ output: "C:/copy/thesis.bib", expectedHash: null });
    expect(saved).toBe("C:/copy/thesis.bib");
    expect(useDocumentStore.getState().sourceFile?.path).toBe("C:/copy/thesis.bib");
  });
});
