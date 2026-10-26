import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { useFurnitureEditing } from "./furnitureEditing";
import { contentInsets, createDocument } from "./model";
import { SheetFurniture } from "./SheetFurniture";

let editor: Editor | null = null;

const settings = () => useDocumentStore.getState().document!.settings;

function mountToolbar() {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: "<p>Text</p>" });
  render(<DocumentToolbar editor={editor} contentWidth={400} />);
}

function pick(button: string, item: string) {
  fireEvent.click(screen.getByTestId(button));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: item }));
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
  useFurnitureEditing.setState({ editing: null, request: null });
  useDocumentStore.getState().close();
});

describe("document settings in the ribbon", () => {
  it("sets the body text size from the Design tab", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));

    fireEvent.click(screen.getByRole("combobox", { name: "Text size" }));
    fireEvent.click(screen.getByRole("option", { name: "12 pt" }));

    expect(settings().fontSize).toBe(12);
  });

  it("numbers the headings from the Design tab", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));

    pick("doc-heading-numbers", "1., 1.1., 1.1.1.");

    expect(settings().headingNumbers).toBe("dotted");
  });

  it("turns the cover on from a style and asks for its details the first time", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));

    pick("doc-cover", "Colour band");

    expect(settings()).toMatchObject({ cover: true, coverStyle: "band" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Annual report" } });
    expect(settings().title).toBe("Annual report");
    pick("doc-cover", "No cover");
    expect(settings().cover).toBe(false);
  });

  it("adds contents with the chosen depth and removes them again", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "References" }));

    pick("doc-toc", "3 levels");
    expect(settings()).toMatchObject({ toc: true, tocDepth: 3 });

    pick("doc-toc", "No contents");
    expect(settings().toc).toBe(false);
  });

  it("opens the Header & footer tab from Insert and goes back to Insert when it closes", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));

    fireEvent.click(screen.getByTestId("doc-insert-header"));
    expect(screen.getByRole("tab", { name: "Header & footer" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    fireEvent.click(screen.getByTestId("doc-furniture-close"));

    expect(settings().headerAlign).toBe("right");
    expect(screen.queryByRole("tab", { name: "Header & footer" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("header and footer on the sheet", () => {
  function mountSheet(onLeave = vi.fn()) {
    const current = settings();
    render(<SheetFurniture settings={current} inset={contentInsets(current)} page={2} total={5} onLeave={onLeave} />);
    return onLeave;
  }

  it("writes the header typed on the sheet into the document and marks the band being edited", () => {
    mountSheet();
    const header = screen.getByTestId("sheet-header");

    fireEvent.focus(header);
    fireEvent.change(header, { target: { value: "Thesis draft" } });

    expect(settings().header).toBe("Thesis draft");
    expect(screen.getByTestId("sheet-header-band").dataset.editing).toBe("true");
  });

  it("shows the page number in its format next to a footer on the same side", () => {
    useDocumentStore.getState().setSettings({ pageNumbers: "right", footerAlign: "right", footer: "Draft", pageNumberFormat: "Page {n} of {total}" });
    mountSheet();

    expect(screen.getByTestId("sheet-page-number").textContent).toBe("Page 2 of 5");
  });

  it("leaves the footer for the text with Escape", () => {
    const onLeave = mountSheet();
    const footer = screen.getByTestId("sheet-footer");
    fireEvent.focus(footer);

    fireEvent.keyDown(footer, { key: "Escape" });

    expect(useFurnitureEditing.getState().editing).toBeNull();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
