import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { listPrinters, runPrint } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { axeViolations } from "@/test/axe";

vi.mock("@embedpdf/plugin-annotation/react", () => ({ useAnnotation: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-export/react", () => ({ useExport: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-print/react", () => ({ usePrint: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ state: { currentPage: 2, totalPages: 6 } }) }));
vi.mock("./useUnsavedMarks", () => ({ useUnsavedMarks: () => false }));
vi.mock("@/shared/rpc/operations", () => ({
  listPrinters: vi.fn(async () => ({ printers: [{ name: "Office", isDefault: true }], default: "Office", backend: "windows" })),
  runPrint: vi.fn(async () => ({ printer: "Office", pages: 3, copies: 1, sheets: 1 })),
}));

vi.mock("@/shared/rpc/files", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/shared/rpc/files")>()), deleteFile: vi.fn(async () => undefined) }));

const { PrintDialog } = await import("./PrintDialog");
const { deleteFile } = await import("@/shared/rpc/files");

async function choose(combobox: string, option: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("combobox", { name: combobox }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: option }));
  });
}

async function renderDialog() {
  const view = render(<PrintDialog documentId="doc" />);
  await screen.findByRole("combobox", { name: "Printer" });
  await act(async () => {
    await vi.mocked(listPrinters).mock.results[0]?.value;
  });
  return view;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.mocked(runPrint).mockClear();
  vi.mocked(listPrinters).mockClear();
  useDocumentStore.getState().register("doc", "C:/plans/site.pdf", null);
  usePrintDialogStore.getState().setOpen(true);
});

afterEach(() => {
  cleanup();
  usePrintDialogStore.getState().setOpen(false);
  useDocumentStore.getState().remove("doc");
});

describe("PrintDialog", () => {
  it("sends Acrobat's defaults: every page, markups included, pages turned to the paper", async () => {
    const { container } = await renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
    });
    expect(vi.mocked(runPrint).mock.calls[0][0]).toMatchObject({ path: "C:/plans/site.pdf", printer: "Office", subset: "all", reverse: false, annotations: true, autoRotate: true, pagesPerSheet: 1, scale: "fit" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("passes odd or even pages, reverse order, document only and several pages per sheet", async () => {
    await renderDialog();
    await choose("Odd or even pages", "Even pages only");
    await choose("Pages per sheet", "4");
    await choose("Comments and forms", "Document only (form fields stay)");
    fireEvent.click(screen.getByRole("switch", { name: "Reverse pages" }));
    fireEvent.click(screen.getByRole("switch", { name: "Rotate pages to fit the paper" }));
    expect(screen.getByRole("combobox", { name: "Scale" }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
    });
    expect(vi.mocked(runPrint).mock.calls[0][0]).toMatchObject({ subset: "even", reverse: true, annotations: false, autoRotate: false, pagesPerSheet: 4 });
  });

  it("prints a prepared copy of arranged pages and deletes it afterwards", async () => {
    usePrintDialogStore.getState().openFile({ path: "C:/tmp/vivepdf-pages-1.pdf", password: "pw", pageCount: 4, temporary: true });
    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
    });

    expect(screen.queryByRole("button", { name: "Browser preview" })).toBeNull();
    expect(vi.mocked(runPrint).mock.calls[0][0]).toMatchObject({ path: "C:/tmp/vivepdf-pages-1.pdf", password: "pw" });
    expect(deleteFile).toHaveBeenCalledWith("C:/tmp/vivepdf-pages-1.pdf");
    expect(usePrintDialogStore.getState().file).toBeNull();
  });

  it("keeps the original file when printing chosen pages of it", async () => {
    vi.mocked(deleteFile).mockClear();
    usePrintDialogStore.getState().openFile({ path: "C:/plans/site.pdf", password: null, pageCount: 6, temporary: false });
    await renderDialog();

    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(usePrintDialogStore.getState().open).toBe(false);
  });

  it("does not print while no printer is known", async () => {
    vi.mocked(listPrinters).mockResolvedValueOnce({ printers: [], default: null, backend: "none" });
    render(<PrintDialog documentId="doc" />);
    expect(await screen.findByText("No printer found on this computer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" }).hasAttribute("disabled")).toBe(true);
  });
});
