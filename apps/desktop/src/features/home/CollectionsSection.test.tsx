import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import { useCollectionsStore } from "./collectionsStore";

const openDialog = vi.fn();
const openCollection = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));
vi.mock("./useOpenCollection", () => ({ useOpenCollection: () => openCollection }));

const { CollectionsSection } = await import("./CollectionsSection");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  openDialog.mockReset();
  openCollection.mockReset();
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
});
