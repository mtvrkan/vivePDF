import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useToastStore } from "@/shared/store/toastStore";

const openDialog = vi.fn();
const listPdfs = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));
vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo: () => Promise.resolve({ pageCount: 2, encrypted: false }) }));
vi.mock("@/shared/rpc/operations", () => ({
  listPdfs: (...args: unknown[]) => listPdfs(...args),
  mergePdfs: vi.fn(),
}));

const { MergePage } = await import("./MergePage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tools/merge"]}>
      <MergePage />
    </MemoryRouter>,
  );
}

const listedNames = () => screen.queryAllByRole("button", { name: /^Remove .* from the list$/ }).map((button) => button.getAttribute("aria-label"));
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

function drop(paths: string[]) {
  const handler = useDropTargetStore.getState().handler;
  if (!handler) throw new Error("merge page registered no drop handler");
  act(() => handler(paths));
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  openDialog.mockReset();
  listPdfs.mockReset();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("MergePage adding files", () => {
  it("adds every PDF of a picked folder in the order the engine lists them", async () => {
    openDialog.mockResolvedValue("C:\\Scans");
    listPdfs.mockResolvedValue({ files: ["C:\\Scans\\page2.pdf", "C:\\Scans\\page10.pdf"], entries: [], truncated: false });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() => expect(listedNames()).toEqual(["Remove page2.pdf from the list", "Remove page10.pdf from the list"]));
    expect(openDialog).toHaveBeenCalledWith({ multiple: false, directory: true });
    expect(listPdfs).toHaveBeenCalledWith({ folder: "C:\\Scans", recursive: false });
  });

  it("lists subfolders too when asked", async () => {
    openDialog.mockResolvedValue("C:\\Scans");
    listPdfs.mockResolvedValue({ files: ["C:\\Scans\\a.pdf"], entries: [], truncated: false });
    renderPage();

    fireEvent.click(screen.getByRole("switch", { name: "Include subfolders" }));
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() => expect(listPdfs).toHaveBeenCalledWith({ folder: "C:\\Scans", recursive: true }));
  });

  it("expands a dropped folder and skips files that are already listed, whatever their case or slashes", async () => {
    listPdfs.mockResolvedValue({ files: ["C:\\in\\a.pdf", "C:\\in\\b.pdf"], entries: [], truncated: false });
    renderPage();
    drop(["C:\\in\\A.PDF"]);
    await waitFor(() => expect(listedNames()).toHaveLength(1));

    drop(["C:/in", "c:/IN/a.pdf"]);

    await waitFor(() => expect(listedNames()).toEqual(["Remove A.PDF from the list", "Remove b.pdf from the list"]));
    expect(listPdfs).toHaveBeenCalledWith({ folder: "C:/in", recursive: false });
    expect(toasts()).toEqual(["2 files were already in the list and were not added again."]);
  });

  it("does not add a picked file twice and says so", async () => {
    openDialog.mockResolvedValueOnce(["C:\\docs\\x.pdf"]).mockResolvedValueOnce(["C:/docs/X.pdf", "C:\\docs\\y.pdf"]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Add PDF documents/ }));
    await waitFor(() => expect(listedNames()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Add files" }));

    await waitFor(() => expect(listedNames()).toEqual(["Remove x.pdf from the list", "Remove y.pdf from the list"]));
    expect(toasts()).toEqual(["1 file was already in the list and was not added again."]);
  });

  it("ignores a dropped item the engine cannot open as a folder", async () => {
    listPdfs.mockRejectedValue({ code: "FILE_NOT_FOUND", message: "folder not found" });
    renderPage();

    drop(["C:\\in\\archive.zip"]);

    await waitFor(() => expect(listPdfs).toHaveBeenCalled());
    expect(listedNames()).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("reports an empty folder", async () => {
    openDialog.mockResolvedValue("C:\\Empty");
    listPdfs.mockResolvedValue({ files: [], entries: [], truncated: false });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() => expect(toasts()).toEqual(["No PDF documents were found in Empty."]));
    expect(listedNames()).toEqual([]);
  });
});
