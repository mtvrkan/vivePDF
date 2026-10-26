import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fontCatalogue } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { useDocumentViewStore } from "./documentView";
import { DocumentToolbar } from "./DocumentToolbar";
import { useFurnitureEditing } from "./furnitureEditing";
import { contentInsets, createDocument } from "./model";
import { SheetFurniture } from "./SheetFurniture";

vi.mock("@/shared/rpc/operations", async (importOriginal) => ({ ...(await importOriginal<object>()), fontCatalogue: vi.fn() }));

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
  useDocumentViewStore.setState({ darkPage: false });
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

  it("darkens only the page from the View tab and remembers it", () => {
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));

    fireEvent.click(screen.getByTestId("doc-dark-page"));

    expect(useDocumentViewStore.getState().darkPage).toBe(true);
    expect(localStorage.getItem("vivepdf.documentDarkPage")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies the 4 cm thesis rule with Times New Roman from the Layout tab", async () => {
    vi.mocked(fontCatalogue).mockResolvedValue({ fonts: [{ id: "system:timesnew", name: "Times New Roman", source: "system" }] } as never);
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    pick("doc-thesis-rules", "Left 4 cm · top, bottom and right 2.5 cm");

    expect(settings()).toMatchObject({ paper: "a4", marginLeftMm: 40, marginTopMm: 25, fontSize: 12, lineHeight: 1.5, pageNumbers: "center" });
    await waitFor(() => expect(settings().fontId).toBe("system:timesnew"));
    fireEvent.click(screen.getByTestId("doc-thesis-rules"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Left 4 cm · top, bottom and right 2.5 cm" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the font and says so when Times New Roman is missing", async () => {
    vi.mocked(fontCatalogue).mockResolvedValue({ fonts: [] } as never);
    mountToolbar();
    const before = settings().fontId;
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    pick("doc-thesis-rules", "Left 3.5 cm · right 2.5 cm · top and bottom 3 cm");

    expect(settings()).toMatchObject({ marginLeftMm: 35, marginTopMm: 30 });
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/Times New Roman is not on this computer/));
    expect(settings().fontId).toBe(before);
  });

  it("still applies the margins when the font list cannot be read", async () => {
    vi.mocked(fontCatalogue).mockRejectedValue(new Error("engine down"));
    mountToolbar();
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    pick("doc-thesis-rules", "Left 4 cm · top, bottom and right 2.5 cm");

    expect(settings().marginLeftMm).toBe(40);
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/not on this computer/));
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
  function mountSheet(onLeave = vi.fn(), label = "2", last = "5") {
    const current = settings();
    render(<SheetFurniture settings={current} inset={contentInsets(current)} page={2} label={label} last={last} onLeave={onLeave} />);
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

  it("shows the engine's page label, such as a roman front page number", () => {
    useDocumentStore.getState().setSettings({ pageNumbers: "center", pageNumberFormat: "{n} / {total}" });
    mountSheet(vi.fn(), "ii", "12");

    expect(screen.getByTestId("sheet-page-number").textContent).toBe("ii / 12");
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
