import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { storeCitationSource } from "./citationSource";
import { useDocumentStore } from "./documentStore";
import { documentExtensions } from "./extensions";
import { createDocument } from "./model";
import { SourcesDialog } from "./SourcesDialog";

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
const operations = vi.hoisted(() => ({ studioReadBibliography: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@/shared/rpc/operations", () => operations);
const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tauri-apps/api/core")>()), invoke: (...args: unknown[]) => core.invoke(...args) }));
const sourcesRpc = vi.hoisted(() => ({ lookupDoi: vi.fn(), detectDoi: vi.fn(), checkSources: vi.fn() }));
vi.mock("@/shared/rpc/sources", () => sourcesRpc);
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const KNUTH = "@book{knuth, author={Knuth, Donald}, title={The Art of Computer Programming}, publisher={AW}, year=1968}";
const NATURE_DOI = "10.1038/nature12373";
const NATURE_CSL = JSON.stringify({ type: "article-journal", DOI: NATURE_DOI, title: "Nanometre-scale thermometry in a living cell", "container-title": "Nature", volume: "500", page: "54-58", issued: { "date-parts": [[2013, 7, 31]] }, author: [{ family: "Kucsko", given: "G." }] });
const NATURE_SOURCE = { key: "kucsko2013", type: "article", fields: { title: "Nanometre-scale thermometry", year: "2013", doi: NATURE_DOI }, authors: [{ family: "Kucsko", given: "G." }], editors: [] };

let editor: Editor | null = null;

function mount(content = "<p>Text</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  const onClose = vi.fn();
  render(<SourcesDialog editor={editor} open onClose={onClose} />);
  return { current: editor, onClose };
}

function citations(current: Editor) {
  const found: unknown[] = [];
  current.state.doc.descendants((node) => {
    if (node.type.name === "citation") found.push(node.attrs.items);
  });
  return found;
}

describe("SourcesDialog", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    useDocumentStore.getState().open(createDocument("Paper"));
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    editor?.destroy();
    editor = null;
    vi.clearAllMocks();
  });

  it("starts empty with a way to import or paste sources", () => {
    mount();

    expect(screen.getByText("No sources yet")).toBeTruthy();
    expect(screen.getByTestId("cite-import")).toBeTruthy();
    expect((screen.getByTestId("cite-insert") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds pasted BibTeX and cites the chosen source with a page", () => {
    const { current, onClose } = mount();

    fireEvent.click(screen.getByTestId("cite-paste"));
    fireEvent.change(screen.getByLabelText("BibTeX, RIS or CSL JSON text"), { target: { value: KNUTH } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: /The Art of Computer Programming/ }));
    fireEvent.change(screen.getByLabelText("Page (optional)"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("cite-insert"));

    expect(useDocumentStore.getState().document?.sources.map((entry) => entry.key)).toEqual(["knuth"]);
    expect(citations(current)).toEqual([[{ key: "knuth", locator: "12" }]]);
    expect(current.view.dom.querySelector(".vp-cite")?.textContent).toBe("(Knuth, 1968, p. 12)");
    expect(onClose).toHaveBeenCalled();
  });

  it("imports a .bib file and reports a file that cannot be read", async () => {
    dialog.open.mockResolvedValue("C:/refs/library.bib");
    operations.studioReadBibliography.mockResolvedValueOnce({ text: KNUTH, name: "library.bib" }).mockRejectedValueOnce({ code: "FILE_NOT_FOUND", message: "gone" });
    mount();

    fireEvent.click(screen.getByTestId("cite-import"));
    await waitFor(() => expect(useDocumentStore.getState().document?.sources).toHaveLength(1));
    fireEvent.click(screen.getByTestId("cite-import"));
    await waitFor(() => expect(useToastStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(true));

    expect(operations.studioReadBibliography).toHaveBeenCalledWith({ path: "C:/refs/library.bib" });
    expect(useDocumentStore.getState().document?.sources).toHaveLength(1);
  });

  it("updates the selected citation instead of adding another", () => {
    act(() => useDocumentStore.getState().setSources([{ key: "knuth", type: "book", fields: { title: "The Art", year: "1968" }, authors: [{ family: "Knuth", given: "Donald" }], editors: [] }]));
    editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: '<p>See <span data-citation=\'[{"key":"knuth","locator":"3"}]\'></span></p>' });
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "citation") position = pos;
    });
    editor.commands.setNodeSelection(position);
    render(<SourcesDialog editor={editor} open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Page (optional)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Update citation" }));

    expect(citations(editor)).toEqual([[{ key: "knuth", locator: "9" }]]);
  });

  it("edits a source and carries a renamed key into the citations already in the text", () => {
    act(() => useDocumentStore.getState().setSources([{ key: "knuth", type: "book", fields: { title: "The Art", year: "1968", abstract: "Kept" }, authors: [{ family: "Knuth", given: "Donald" }], editors: [] }]));
    const { current } = mount('<p>See <span data-citation=\'[{"key":"knuth","locator":"3"}]\'></span></p>');

    fireEvent.click(screen.getByRole("button", { name: "Edit knuth" }));
    fireEvent.change(screen.getByLabelText("Citation key"), { target: { value: "knuth1968" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "The Art of Computer Programming" } });
    fireEvent.change(screen.getByLabelText("Publisher"), { target: { value: "Addison-Wesley" } });
    fireEvent.click(screen.getByTestId("cite-save"));

    expect(useDocumentStore.getState().document?.sources).toEqual([
      { key: "knuth1968", type: "book", fields: { title: "The Art of Computer Programming", year: "1968", abstract: "Kept", publisher: "Addison-Wesley" }, authors: [{ family: "Knuth", given: "Donald" }], editors: [] },
    ]);
    expect(citations(current)).toEqual([[{ key: "knuth1968", locator: "3" }]]);
    expect(current.view.dom.querySelector(".vp-cite")?.textContent).toBe("(Knuth, 1968, p. 3)");
  });

  it("adds a source by hand, refuses a key that is already used and makes one up when left empty", () => {
    act(() => useDocumentStore.getState().setSources([{ key: "knuth", type: "book", fields: { title: "The Art" }, authors: [], editors: [] }]));
    mount();

    fireEvent.click(screen.getByTestId("cite-new"));
    fireEvent.change(screen.getByLabelText("Citation key"), { target: { value: "KNUTH" } });

    expect(screen.getByRole("alert").textContent).toBe("Another source already uses this key");
    expect((screen.getByTestId("cite-save") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Citation key"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kentsel ısı adaları" } });
    fireEvent.change(screen.getByLabelText("Authors"), { target: { value: "Yılmaz, Ayşe\n{TÜBİTAK}" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2020" } });
    fireEvent.click(screen.getByTestId("cite-save"));

    const added = useDocumentStore.getState().document?.sources[1];
    expect(added).toMatchObject({ key: "yilmaz2020kentsel", type: "article", fields: { title: "Kentsel ısı adaları", year: "2020" } });
    expect(added?.authors).toEqual([
      { family: "Yılmaz", given: "Ayşe" },
      { family: "TÜBİTAK", given: "", literal: true },
    ]);
    expect(screen.getByRole("button", { name: /Kentsel ısı adaları/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reads RIS and CSL JSON libraries and exports in the format the file name asks for", async () => {
    core.invoke.mockResolvedValue(undefined);
    dialog.open.mockResolvedValue("C:/refs/zotero.ris");
    dialog.save.mockResolvedValue("C:/refs/out.json");
    operations.studioReadBibliography.mockResolvedValueOnce({ text: "TY  - BOOK\nID  - knuth\nAU  - Knuth, Donald\nTI  - The Art\nPY  - 1968\nER  - \n", name: "zotero.ris" });
    mount();

    fireEvent.click(screen.getByTestId("cite-import"));
    await waitFor(() => expect(useDocumentStore.getState().document?.sources.map((entry) => entry.key)).toEqual(["knuth"]));
    fireEvent.click(screen.getByTestId("cite-export"));
    await waitFor(() => expect(core.invoke).toHaveBeenCalled());

    const [command, args] = core.invoke.mock.calls[0] as [string, { path: string; contents: string }];
    expect(command).toBe("write_text_file");
    expect(args.path).toBe("C:/refs/out.json");
    expect(JSON.parse(args.contents)).toEqual([{ id: "knuth", type: "book", title: "The Art", author: [{ family: "Knuth", given: "Donald" }], issued: { "date-parts": [[1968]] } }]);
  });

  it("fetches a source by DOI into the editor for review before it is saved", async () => {
    sourcesRpc.lookupDoi.mockResolvedValue({ doi: NATURE_DOI, csl: NATURE_CSL });
    mount();

    fireEvent.click(screen.getByTestId("cite-doi"));
    fireEvent.change(screen.getByTestId("cite-doi-input"), { target: { value: `https://doi.org/${NATURE_DOI}` } });
    fireEvent.click(screen.getByTestId("cite-doi-fetch"));
    await screen.findByTestId("cite-editor");

    expect(sourcesRpc.lookupDoi).toHaveBeenCalledWith({ doi: `https://doi.org/${NATURE_DOI}` });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Nanometre-scale thermometry in a living cell");
    fireEvent.click(screen.getByTestId("cite-save"));
    expect(useDocumentStore.getState().document?.sources[0]).toMatchObject({ key: "kucsko2013nanometresca", fields: { journal: "Nature", volume: "500", doi: NATURE_DOI } });
  });

  it("opens the existing source instead of fetching a DOI that is already there", () => {
    act(() => useDocumentStore.getState().setSources([NATURE_SOURCE]));
    mount();

    fireEvent.click(screen.getByTestId("cite-doi"));
    fireEvent.change(screen.getByTestId("cite-doi-input"), { target: { value: "doi:10.1038/NATURE12373" } });
    fireEvent.click(screen.getByTestId("cite-doi-fetch"));

    expect(sourcesRpc.lookupDoi).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Citation key") as HTMLInputElement).value).toBe("kucsko2013");
  });

  it("starts a source from the PDF title when the PDF has no DOI, and explains a lookup that fails", async () => {
    dialog.open.mockResolvedValue("C:/papers/paper.pdf");
    sourcesRpc.detectDoi.mockResolvedValueOnce({ doi: null, title: "Urban heat islands" }).mockResolvedValueOnce({ doi: "10.5555/x", title: null });
    sourcesRpc.lookupDoi.mockRejectedValue({ code: "NETWORK", message: "offline", data: { reason: "doiOffline" } });
    mount();

    fireEvent.click(screen.getByTestId("cite-pdf"));
    await screen.findByTestId("cite-editor");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Urban heat islands");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByTestId("cite-pdf"));
    await waitFor(() => expect(useToastStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(true));

    expect(sourcesRpc.detectDoi).toHaveBeenCalledWith({ path: "C:/papers/paper.pdf" });
    expect(useToastStore.getState().toasts.find((toast) => toast.kind === "error")?.message).toBe("Could not reach doi.org or Crossref; check your internet connection.");
    expect((screen.getByLabelText("DOI") as HTMLInputElement).value).toBe("10.5555/x");
  });

  it("fills an open source from its DOI", async () => {
    sourcesRpc.lookupDoi.mockResolvedValue({ doi: NATURE_DOI, csl: NATURE_CSL });
    mount();

    fireEvent.click(screen.getByTestId("cite-new"));
    fireEvent.change(screen.getByLabelText("Citation key"), { target: { value: "mine" } });
    fireEvent.change(screen.getByLabelText("DOI"), { target: { value: NATURE_DOI } });
    fireEvent.click(screen.getByTestId("cite-fill-doi"));

    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Nanometre-scale thermometry in a living cell"));
    expect((screen.getByLabelText("Citation key") as HTMLInputElement).value).toBe("mine");
    expect((screen.getByLabelText("Journal") as HTMLInputElement).value).toBe("Nature");
  });

  it("checks sources and marks a retracted one with a link to its notice", async () => {
    act(() => useDocumentStore.getState().setSources([NATURE_SOURCE, { key: "wakefield", type: "article", fields: { title: "Ileal-lymphoid-nodular hyperplasia", doi: "10.1016/S0140-6736(97)11096-0" }, authors: [], editors: [] }]));
    sourcesRpc.checkSources.mockResolvedValue({
      items: [
        { doi: NATURE_DOI, status: "ok", notices: [], publishedVersion: null },
        { doi: "10.1016/S0140-6736(97)11096-0", status: "retracted", notices: [{ type: "retraction", doi: "10.1016/s0140-6736(10)60175-4", date: "2010-02-06", source: "retraction-watch" }], publishedVersion: null },
      ],
    });
    mount();

    fireEvent.click(screen.getByTestId("cite-check"));
    const retracted = await screen.findByRole("button", { name: "Retracted" });
    fireEvent.click(retracted);

    expect(sourcesRpc.checkSources).toHaveBeenCalledWith({ dois: [NATURE_DOI, "10.1016/S0140-6736(97)11096-0"] }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText("No notices")).toBeTruthy();
    expect(opener.openUrl).toHaveBeenCalledWith("https://doi.org/10.1016/s0140-6736(10)60175-4");
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe("Checked sources: 2 — with notices: 1.");
  });

  it("shows what the published record would change and applies it on confirm", async () => {
    act(() => useDocumentStore.getState().setSources([NATURE_SOURCE]));
    sourcesRpc.lookupDoi.mockResolvedValue({ doi: NATURE_DOI, csl: NATURE_CSL });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Update details of kucsko2013" }));
    const review = await screen.findByTestId("cite-review");

    expect(review.textContent).toContain("Nanometre-scale thermometry in a living cell");
    fireEvent.click(screen.getByTestId("cite-apply-update"));
    expect(useDocumentStore.getState().document?.sources[0]).toMatchObject({ key: "kucsko2013", fields: { title: "Nanometre-scale thermometry in a living cell", journal: "Nature", pages: "54-58", doi: NATURE_DOI } });
  });
});
