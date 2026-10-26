import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { useDocumentViewStore } from "./documentView";
import { currentHeadingIndex, headingOutline, visibleHeadings } from "./headingOutline";
import { createDocument } from "./model";
import { NavigationPane } from "./NavigationPane";

const REPORT = "<h1>Introduction</h1><p>Opening words</p><h2>Scope</h2><p>Body</p><h3>Limits</h3><h1>Results</h1><p>End</p>";

let editor: Editor | null = null;

function makeEditor(content: string) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  return editor;
}

function headingNames() {
  return screen.queryAllByTestId("document-navigation-heading").map((item) => item.textContent);
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  useDocumentStore.getState().open(createDocument("Report"));
});

afterEach(() => {
  localStorage.clear();
  cleanup();
  editor?.destroy();
  editor = null;
  useDocumentViewStore.setState({ navigation: false });
  useDocumentStore.getState().close();
});

describe("heading outline", () => {
  it("lists every heading with its level and text in document order", () => {
    const outline = headingOutline(makeEditor(REPORT).state.doc);

    expect(outline.map(({ level, text }) => [level, text])).toEqual([
      [1, "Introduction"],
      [2, "Scope"],
      [3, "Limits"],
      [1, "Results"],
    ]);
  });

  it("marks no heading while the cursor is above the first one", () => {
    const outline = headingOutline(makeEditor("<p>Preface</p><h1>Start</h1>").state.doc);

    expect(currentHeadingIndex(outline, 1)).toBe(-1);
  });

  it("hides the headings under a collapsed heading until the next one at its level", () => {
    const outline = headingOutline(makeEditor(REPORT).state.doc);

    expect(visibleHeadings(outline, new Set([0]))).toEqual([0, 3]);
    expect(visibleHeadings(outline, new Set([1]))).toEqual([0, 1, 3]);
  });
});

describe("navigation pane", () => {
  it("shows the headings, marks the one holding the cursor and jumps to a heading", () => {
    const shown = makeEditor(REPORT);
    render(<NavigationPane editor={shown} />);

    expect(headingNames()).toEqual(["Introduction", "Scope", "Limits", "Results"]);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));

    expect(shown.state.selection.$head.parent.textContent).toBe("Results");
    expect(screen.getByRole("button", { name: "Results" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("button", { name: "Introduction" }).hasAttribute("aria-current")).toBe(false);
  });

  it("follows edits and folds a heading's subheadings", () => {
    const shown = makeEditor(REPORT);
    render(<NavigationPane editor={shown} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    expect(headingNames()).toEqual(["Introduction", "Results"]);
    act(() => {
      shown.chain().setTextSelection(shown.state.doc.content.size).insertContent("<h2>Next steps</h2>").run();
    });

    expect(headingNames()).toEqual(["Introduction", "Results", "Next steps"]);
  });

  it("explains the empty pane and turns the current line into a heading", () => {
    const shown = makeEditor("<p>Only text</p>");
    render(<NavigationPane editor={shown} />);

    expect(screen.getByText("No headings yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("document-navigation-make-heading"));

    expect(headingNames()).toEqual(["Only text"]);
  });

  it("is opened from View and closed from its own button, and the choice is kept", () => {
    const shown = makeEditor(REPORT);
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "View" }));

    fireEvent.click(screen.getByTestId("doc-navigation"));
    expect(useDocumentViewStore.getState().navigation).toBe(true);
    expect(localStorage.getItem("vivepdf.documentNavigation")).toBe("true");

    cleanup();
    render(<NavigationPane editor={shown} />);
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(useDocumentViewStore.getState().navigation).toBe(false);
  });
});
