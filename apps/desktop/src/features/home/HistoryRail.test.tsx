import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useHistoryStore } from "@/shared/store/historyStore";
import { useToastStore } from "@/shared/store/toastStore";

const invoke = vi.fn();
const deleteFile = vi.fn();

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@/features/viewer/useOpenPdf", () => ({ useOpenPdf: () => ({ openPath: vi.fn() }) }));
vi.mock("@/shared/rpc/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/rpc/files")>()),
  deleteFile: (...args: unknown[]) => deleteFile(...args),
}));

const { HistoryRail } = await import("./HistoryRail");

const entry = { id: "h1", tool: "/tools/merge", source: null, outputs: ["C:/Out/a.pdf", "C:/Out/b.pdf"], at: Date.now() };

const existence = (exists: (path: string) => boolean) => (_command: string, args: { paths: string[] }) => Promise.resolve(args.paths.map(exists));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(existence(() => true));
  deleteFile.mockReset();
  useToastStore.setState({ toasts: [] });
  useHistoryStore.setState({ items: [entry] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const confirmDelete = () => {
  fireEvent.click(screen.getByRole("button", { name: "Delete result" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete result" }));
};

describe("HistoryRail", () => {
  it("treats an already deleted output as gone and removes the entry once all outputs are gone", async () => {
    deleteFile.mockImplementation((path: string) => (path === "C:/Out/a.pdf" ? Promise.reject(new RpcCallError({ code: "FILE_NOT_FOUND", message: "gone" })) : Promise.resolve()));
    render(<HistoryRail />);

    confirmDelete();

    await waitFor(() => expect(useHistoryStore.getState().items).toEqual([]));
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });

  it("keeps the entry and still deletes the other outputs when one deletion fails", async () => {
    deleteFile.mockImplementation((path: string) => (path === "C:/Out/a.pdf" ? Promise.reject(new RpcCallError({ code: "INTERNAL", message: "denied" })) : Promise.resolve()));
    render(<HistoryRail />);

    confirmDelete();

    await waitFor(() => expect(deleteFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useHistoryStore.getState().items).toHaveLength(1);
  });

  it("lists an entry normally while any output still exists", async () => {
    invoke.mockImplementation(existence((path) => path === "C:/Out/a.pdf"));
    render(<HistoryRail />);

    await waitFor(() => expect(invoke).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Remove from list" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete result" })).toBeTruthy();
  });

  it("shows an entry whose outputs are all missing with a remove button", async () => {
    invoke.mockImplementation(existence(() => false));
    render(<HistoryRail />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));

    expect(useHistoryStore.getState().items).toEqual([]);
  });

  it("reports a failed clipboard write when copying the path", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<HistoryRail />);

    fireEvent.contextMenu(screen.getByText("2 output files"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy path" }));

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(writeText).toHaveBeenCalledWith("C:/Out/a.pdf");
  });
});
