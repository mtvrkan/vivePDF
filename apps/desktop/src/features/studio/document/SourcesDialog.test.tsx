import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import i18n, { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { citationTerms, storeCitationSource } from "./citationSource";
import { useDocumentStore } from "./documentStore";
import { documentExtensions } from "./extensions";
import { createDocument } from "./model";
import { SourcesDialog } from "./SourcesDialog";

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
const operations = vi.hoisted(() => ({ studioReadBibliography: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@/shared/rpc/operations", () => operations);

const KNUTH = "@book{knuth, author={Knuth, Donald}, title={The Art of Computer Programming}, publisher={AW}, year=1968}";

let editor: Editor | null = null;

function mount(content = "<p>Text</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(citationTerms(i18n.t), "en", "References", "")), content });
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
    fireEvent.change(screen.getByLabelText("BibTeX text"), { target: { value: KNUTH } });
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
    editor = new Editor({ extensions: documentExtensions("", storeCitationSource(citationTerms(i18n.t), "en", "References", "")), content: '<p>See <span data-citation=\'[{"key":"knuth","locator":"3"}]\'></span></p>' });
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
});
