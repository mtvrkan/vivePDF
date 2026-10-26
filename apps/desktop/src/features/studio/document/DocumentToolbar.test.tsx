import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { CellSelection } from "@tiptap/pm/tables";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { createDocument } from "./model";

const TABLE = "<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>";

let editor: Editor | null = null;

function mount() {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: TABLE });
  render(<DocumentToolbar editor={editor} contentWidth={400} />);
  return editor;
}

function openTableTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Table" }));
}

function cellPositions(current: Editor): number[] {
  const found: number[] = [];
  current.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableHeader" || node.type.name === "tableCell") found.push(pos);
  });
  return found;
}

function headerSpans(current: Editor): number[] {
  const spans: number[] = [];
  current.state.doc.firstChild?.firstChild?.forEach((cell) => spans.push(Number(cell.attrs.colspan ?? 1)));
  return spans;
}

function selectCells(current: Editor, from: number, to: number) {
  act(() => {
    current.view.dispatch(current.state.tr.setSelection(CellSelection.create(current.state.doc, from, to)));
  });
}

function placeCursorIn(current: Editor, cell: number) {
  act(() => {
    current.commands.setTextSelection(cell + 2);
  });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  localStorage.clear();
  cleanup();
  editor?.destroy();
  editor = null;
});

describe("DocumentToolbar table cells", () => {
  it("merges the selected header cells into one spanning cell", () => {
    const current = mount();
    const [first, second] = cellPositions(current);
    selectCells(current, first, second);
    openTableTab();

    fireEvent.click(screen.getByTestId("doc-merge-cells"));

    expect(headerSpans(current)).toEqual([2]);
  });

  it("keeps merge and split off while the cursor sits in a single plain cell", () => {
    const current = mount();
    placeCursorIn(current, cellPositions(current)[2]);
    openTableTab();

    expect((screen.getByTestId("doc-merge-cells") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("doc-split-cell") as HTMLButtonElement).disabled).toBe(true);
  });

  it("splits a merged cell back into its columns", () => {
    const current = mount();
    const [first, second] = cellPositions(current);
    selectCells(current, first, second);
    openTableTab();
    fireEvent.click(screen.getByTestId("doc-merge-cells"));
    placeCursorIn(current, cellPositions(current)[0]);

    fireEvent.click(screen.getByTestId("doc-split-cell"));

    expect(headerSpans(current)).toEqual([1, 1]);
  });
});

describe("DocumentToolbar sources", () => {
  it("opens the Sources window when a source library was just loaded and clears the request on close", () => {
    useDocumentStore.getState().open(createDocument("Library"));
    act(() => useDocumentStore.getState().requestSources(true));
    mount();

    expect(screen.getByRole("dialog", { name: "Sources" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useDocumentStore.getState().sourcesRequested).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Sources" })).toBeNull();
  });
});

describe("DocumentToolbar ribbon", () => {
  it("shows the Table tab only while the cursor is in a table and falls back to Home when it leaves", () => {
    const current = mount();
    act(() => {
      current.commands.insertContentAt(current.state.doc.content.size, "<p>After</p>");
    });
    placeCursorIn(current, cellPositions(current)[0]);
    openTableTab();

    act(() => {
      current.commands.setTextSelection(current.state.doc.content.size - 2);
    });

    expect(screen.queryByRole("tab", { name: "Table" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
  });

  it("writes the chosen margin from the Layout tab into the document settings", () => {
    useDocumentStore.getState().open(createDocument("Margins"));
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    fireEvent.click(screen.getByTestId("doc-margins"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "30 mm" }));

    expect(useDocumentStore.getState().document?.settings.marginMm).toBe(30);
  });

  it("moves between tabs with the arrow keys and wraps from the last tab to the first", () => {
    mount();
    const home = screen.getByRole("tab", { name: "Home" });
    home.focus();

    fireEvent.keyDown(home, { key: "ArrowLeft" });

    const last = screen.getByRole("tab", { name: "Table" });
    expect(last.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(last);
  });

  it("hides the panel when collapsed and keeps that choice for the next editor", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Collapse ribbon" }));
    cleanup();
    mount();

    expect(screen.getByRole("tabpanel", { hidden: true }).hidden).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(screen.getByRole("tabpanel").hidden).toBe(false);
  });

  it("asks the editor to open the find and replace bars", () => {
    const onFind = vi.fn();
    editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: "<p>Text</p>" });
    render(<DocumentToolbar editor={editor} contentWidth={400} onFind={onFind} />);

    fireEvent.click(screen.getByTestId("doc-ribbon-replace"));

    expect(onFind).toHaveBeenCalledWith(true);
  });
});
