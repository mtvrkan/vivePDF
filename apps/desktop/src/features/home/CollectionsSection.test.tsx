import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import { useCollectionsStore } from "./collectionsStore";

const openDialog = vi.fn();
const openCollection = vi.fn();
const openPath = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));
vi.mock("./useOpenCollection", () => ({ useOpenCollection: () => openCollection }));
vi.mock("@/features/viewer/useOpenPdf", () => ({ useOpenPdf: () => ({ openPath }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { CollectionsSection } = await import("./CollectionsSection");

beforeAll(async () => {
  Element.prototype.scrollIntoView = () => undefined;
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  openDialog.mockReset();
  openCollection.mockReset();
  openCollection.mockResolvedValue(true);
  openPath.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue([]);
  useCollectionsStore.setState({ collections: [] });
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("CollectionsSection", () => {
  it("explains collections when there are none and creates one from picked files", async () => {
    openDialog.mockResolvedValue(["C:/Docs/a.pdf", "C:/Docs/b.docx"]);
    const { container } = render(<CollectionsSection />);
    expect(screen.getByText("No collections yet")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Create a collection" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Contracts" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add files…" })));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useCollectionsStore.getState().collections).toMatchObject([{ name: "Contracts", paths: ["C:/Docs/a.pdf", "C:/Docs/b.docx"] }]);
    expect(screen.getByText("2 files")).toBeTruthy();
  });

  it("keeps Save off until the collection has a name and a file, and starts with the open documents", () => {
    useDocumentStore.getState().register("d1", "C:/Docs/open.pdf", null);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Create a collection" }));

    expect(screen.getByText("open.pdf")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when none of the collection's files exist any more", async () => {
    openCollection.mockResolvedValue(false);
    useCollectionsStore.getState().create("Invoices", ["C:/Gone/1.pdf"]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Open all" }));

    await waitFor(() => expect(useToastStore.getState().toasts).toMatchObject([{ kind: "error", message: "None of these files exist any more." }]));
  });

  it("opens every file of a collection and deletes it with an undo", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/1.pdf", "C:/Docs/2.pdf"]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(openCollection).toHaveBeenCalledWith(expect.objectContaining({ name: "Invoices" }));

    fireEvent.click(screen.getByRole("button", { name: "Actions for Invoices" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete collection" }));
    expect(useCollectionsStore.getState().collections).toEqual([]);
    act(() => useToastStore.getState().toasts[0].action?.onClick());
    expect(useCollectionsStore.getState().collections).toHaveLength(1);
  });

  it("shows the files of a collection, marks the missing ones and opens one of them", async () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/a.pdf", "C:/Old/gone.pdf"]);
    invoke.mockResolvedValue([true, false]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("File not found")).toBeTruthy());
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
    fireEvent.click(dialog.getByRole("button", { name: "Open a.pdf" }));

    expect(invoke).toHaveBeenCalledWith("path_exists", { paths: ["C:/Docs/a.pdf", "C:/Old/gone.pdf"] });
    expect((screen.queryByRole("dialog"))).toBeNull();
    expect(openPath).toHaveBeenCalledWith("C:/Docs/a.pdf");
  });

  it("recolours a collection from its swatches and takes a file out of it", () => {
    const id = useCollectionsStore.getState().create("Invoices", ["C:/Docs/a.pdf", "C:/Docs/b.pdf"]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("radio", { name: "Teal" }));
    fireEvent.click(dialog.getByRole("button", { name: "Remove from the collection: a.pdf" }));

    expect(useCollectionsStore.getState().collections.find((collection) => collection.id === id)).toMatchObject({ color: "teal", paths: ["C:/Docs/b.pdf"] });
    expect(dialog.getByRole("radio", { name: "Teal" }).getAttribute("aria-checked")).toBe("true");
  });

  it("opens a single file straight from the card", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/a.pdf", "C:/Docs/b.pdf"]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Open b.pdf" }));

    expect(openPath).toHaveBeenCalledWith("C:/Docs/b.pdf");
  });

  it("searches and sorts the files of a collection", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/b.pdf", "C:/Docs/a.pdf", "C:/Other/c.pdf"]);
    render(<CollectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));
    const names = () => Array.from(screen.getByRole("dialog").querySelectorAll("[data-collection-file]")).map((row) => row.getAttribute("data-collection-file"));

    fireEvent.change(dialog.getByLabelText("Search the files"), { target: { value: "docs" } });
    expect(names()).toEqual(["b.pdf", "a.pdf"]);
    fireEvent.change(dialog.getByLabelText("Search the files"), { target: { value: "zzz" } });
    expect(dialog.getByText("No file matches “zzz”.")).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Search the files"), { target: { value: "" } });
    fireEvent.click(dialog.getByRole("combobox", { name: "Sort by" }));
    fireEvent.click(screen.getByRole("option", { name: "Name (A–Z)" }));

    expect(names()).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("opens the selected files in the shown order and removes a selection with an undo", () => {
    const id = useCollectionsStore.getState().create("Invoices", ["C:/Docs/b.pdf", "C:/Docs/a.pdf", "C:/Docs/c.pdf"]);
    render(<CollectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));

    fireEvent.click(dialog.getByRole("checkbox", { name: "Select c.pdf" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Select b.pdf" }));
    expect(dialog.getByText("2 selected")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Open selected" }));
    expect(openCollection).toHaveBeenCalledWith(expect.objectContaining({ id, paths: ["C:/Docs/b.pdf", "C:/Docs/c.pdf"] }));

    fireEvent.click(dialog.getByRole("button", { name: "Remove selected" }));
    expect(useCollectionsStore.getState().collections[0]?.paths).toEqual(["C:/Docs/a.pdf"]);
    act(() => useToastStore.getState().toasts[0]?.action?.onClick());
    expect(useCollectionsStore.getState().collections[0]?.paths).toEqual(["C:/Docs/b.pdf", "C:/Docs/a.pdf", "C:/Docs/c.pdf"]);
  });

  it("selects every shown file at once and clears the selection again", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/a.pdf", "C:/Docs/b.pdf"]);
    render(<CollectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));

    fireEvent.click(dialog.getByRole("checkbox", { name: "Select all shown" }));
    expect(dialog.getByText("2 selected")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Clear selection" }));

    expect(dialog.getByRole("checkbox", { name: "Select a.pdf" }).getAttribute("aria-checked")).toBe("false");
  });

  it("pins a collection to the front from its menu and moves cards with the arrow keys", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/1.pdf"]);
    useCollectionsStore.getState().create("Contracts", ["C:/Docs/2.pdf"]);
    useCollectionsStore.getState().create("Letters", ["C:/Docs/3.pdf"]);
    render(<CollectionsSection />);
    const cards = () => Array.from(document.querySelectorAll("[data-collection]")).map((card) => card.getAttribute("data-collection"));

    fireEvent.click(screen.getByRole("button", { name: "Actions for Letters" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin to the front" }));
    expect(cards()).toEqual(["Letters", "Invoices", "Contracts"]);
    expect(screen.getAllByText("Pinned").length).toBeGreaterThan(0);

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Contracts" }), { key: "ArrowLeft" });
    expect(cards()).toEqual(["Letters", "Contracts", "Invoices"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Move Contracts" }), { key: "ArrowLeft" });
    expect(cards()).toEqual(["Letters", "Contracts", "Invoices"]);
  });

  it("moves a collection later from its menu and turns the move off at the end of the list", () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/1.pdf"]);
    useCollectionsStore.getState().create("Contracts", ["C:/Docs/2.pdf"]);
    render(<CollectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Invoices" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move later" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Invoices" }));

    expect(Array.from(document.querySelectorAll("[data-collection]")).map((card) => card.getAttribute("data-collection"))).toEqual(["Contracts", "Invoices"]);
    expect((screen.getByRole("menuitem", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves missing files out when opening a collection", async () => {
    useCollectionsStore.getState().create("Invoices", ["C:/Docs/a.pdf", "C:/Old/gone.pdf"]);
    invoke.mockResolvedValue([true, false]);
    render(<CollectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("File not found")).toBeTruthy());

    fireEvent.click(dialog.getByRole("button", { name: "Open all" }));

    await waitFor(() => expect(openCollection).toHaveBeenCalledWith(expect.objectContaining({ paths: ["C:/Docs/a.pdf"] })));
  });

  it("opens nothing and shows one toast when every file of the collection is missing", async () => {
    useToastStore.setState({ toasts: [] });
    useCollectionsStore.getState().create("Invoices", ["C:/Old/x.pdf", "C:/Old/gone.pdf"]);
    invoke.mockResolvedValue([false, false]);
    render(<CollectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files in Invoices" }));
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.getAllByText("File not found")).toHaveLength(2));

    fireEvent.click(dialog.getByRole("button", { name: "Open all" }));

    expect(openCollection).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
