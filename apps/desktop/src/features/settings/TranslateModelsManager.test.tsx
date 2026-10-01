import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { translateImport, translateRemove } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useTranslateModelsStore } from "@/shared/store/translateModelsStore";
import { axeViolations } from "@/test/axe";
import type { TranslateModel } from "@/types";

const calls: { id: string; options?: RpcCallOptions }[] = [];

const catalog: TranslateModel[] = [
  { id: "en_de", source: "en", target: "de", version: "1.3", sizeMb: 92, installed: false, origin: "catalog" },
  { id: "de_en", source: "de", target: "en", version: "1.3", sizeMb: 92, installed: true, origin: "catalog" },
  { id: "en_fr", source: "en", target: "fr", version: "1.9", sizeMb: 80, installed: false, origin: "catalog" },
  { id: "fr_en", source: "fr", target: "en", version: "1.9", sizeMb: 81, installed: false, origin: "catalog" },
  { id: "en_nl", source: "en", target: "nl", version: "1.8", sizeMb: 88, installed: true, origin: "custom" },
];

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({
  translateModels: vi.fn(async () => ({ directory: "C:/translate", models: catalog })),
  translateRemove: vi.fn(async () => ({ id: "de_en", installed: [] })),
  translateImport: vi.fn(async () => ({ id: "en_nl", installed: ["en_nl"] })),
  translateDownload: vi.fn(
    (id: string, options?: RpcCallOptions) =>
      new Promise((_resolve, reject) => {
        calls.push({ id, options });
        options?.onProgress?.({ id: "1", progress: 0.4, message: "progress.downloading" });
        options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
      }),
  ),
}));

const { TranslateModelsManager } = await import("./TranslateModelsManager");

beforeEach(() => {
  calls.length = 0;
  vi.mocked(openDialog).mockReset();
  vi.mocked(translateImport).mockClear();
  vi.mocked(translateRemove).mockClear();
  useToastStore.setState({ toasts: [], held: false });
  useTranslateModelsStore.setState({ models: [], directory: null, loading: false, loaded: false, error: null, downloadingLanguage: null, downloadProgress: null });
});

afterEach(cleanup);

describe("TranslateModelsManager", () => {
  it("lists one row per language and imported pairs apart, with an accessible download progress that cancels", async () => {
    const { container } = render(<TranslateModelsManager />);
    const download = await screen.findByRole("button", { name: "Download language: French" });
    expect(screen.getByText("161 MB")).toBeTruthy();
    expect(screen.getByText("Imported models")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove model: English → Dutch" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(download);
    });
    const bar = await screen.findByRole("progressbar");
    expect(calls.map((call) => call.id)).toEqual(["fr_en"]);
    expect(bar.getAttribute("aria-valuenow")).toBe("20");
    expect(bar.getAttribute("aria-label")).toBe("Downloading French");
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel download: French" }));
    });
    expect(calls[0].options?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(["Model download cancelled."]);
  });

  it("completes a half installed language with only its missing direction and removes it", async () => {
    render(<TranslateModelsManager />);
    const complete = await screen.findByRole("button", { name: "Complete: German" });
    expect(screen.getByText("One direction only")).toBeTruthy();
    await act(async () => {
      fireEvent.click(complete);
    });
    expect(calls.map((call) => call.id)).toEqual(["en_de"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel download: German" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove language: German" }));
    });
    expect(vi.mocked(translateRemove).mock.calls.map(([id]) => id)).toEqual(["de_en"]);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain("Language removed.");
  });

  it("shows a recovery empty state when the search matches nothing", async () => {
    render(<TranslateModelsManager />);
    await screen.findByRole("button", { name: "Download language: French" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search languages" }), { target: { value: "klingon" } });
    expect(screen.getByText("No language matches")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("button", { name: "Download language: French" })).toBeTruthy();
  });

  it("imports a picked package and names the pair it installed", async () => {
    vi.mocked(openDialog).mockResolvedValueOnce("C:/models/en_nl.argosmodel");
    render(<TranslateModelsManager />);
    await screen.findByRole("button", { name: "Download language: French" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import model" }));
    });
    expect(translateImport).toHaveBeenCalledWith("C:/models/en_nl.argosmodel");
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(["English → Dutch imported."]);
  });

  it("does nothing when the file picker is closed", async () => {
    vi.mocked(openDialog).mockResolvedValueOnce(null);
    render(<TranslateModelsManager />);
    await screen.findByRole("button", { name: "Download language: French" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import model" }));
    });
    expect(translateImport).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
