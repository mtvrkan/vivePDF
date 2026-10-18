import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useReportStore } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { ReportDialog } from "./ReportDialog";

const tauri = vi.hoisted(() => ({ openUrl: vi.fn(), save: vi.fn(), open: vi.fn(), invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: tauri.save, open: tauri.open }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const writeText = vi.fn();

function pastePicture(type = "image/png") {
  const file = new File([PNG_BYTES], "image.png", { type });
  const items = [{ kind: "file", type, getAsFile: () => file }];
  fireEvent.paste(screen.getByRole("textbox", { name: "Description" }), { clipboardData: { items } });
}

function rpcPayloads() {
  return tauri.invoke.mock.calls.filter(([command]) => command === "rpc").map(([, payload]) => payload as { method: string; params: Record<string, unknown> });
}

describe("report dialog attachments", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeText.mockReset().mockResolvedValue(undefined);
    tauri.save.mockReset();
    tauri.open.mockReset();
    tauri.openUrl.mockReset().mockResolvedValue(undefined);
    tauri.invoke.mockReset().mockImplementation(async (command: string) => (command === "rpc" ? { output: "C:/out/support.zip", bytes: 1, files: 4 } : null));
    useToastStore.setState({ toasts: [] });
    useReportStore.getState().openDialog({ category: "bug" });
    useReportStore.setState({ description: "Export breaks", includeDiagnostics: false });
  });

  afterEach(() => {
    cleanup();
    useReportStore.getState().close();
  });

  it("adds a pasted screenshot and never puts it in the copied text or the GitHub link", async () => {
    render(<ReportDialog />);

    pastePicture();

    await waitFor(() => expect(screen.getByText("screenshot-1.png")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
    await waitFor(() => expect(tauri.openUrl).toHaveBeenCalled());
    const base64 = useReportStore.getState().images[0].base64;
    expect(writeText.mock.calls[0][0]).not.toContain(base64);
    expect(writeText.mock.calls[0][0]).not.toContain("screenshot-1.png");
    expect(decodeURIComponent(tauri.openUrl.mock.calls[0][0] as string)).not.toContain("screenshot-1.png");
  });

  it("leaves a plain text paste alone", () => {
    render(<ReportDialog />);
    const textbox = screen.getByRole("textbox", { name: "Description" });

    const handled = fireEvent.paste(textbox, { clipboardData: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] } });

    expect(handled).toBe(true);
    expect(useReportStore.getState().images).toEqual([]);
  });

  it("saves picked files, pasted pictures and the description into one package", async () => {
    tauri.open.mockResolvedValueOnce(["C:/docs/broken.pdf", "C:/docs/broken.pdf", "C:/docs/notes.txt"]);
    tauri.save.mockResolvedValueOnce("C:/out/support.zip");
    render(<ReportDialog />);
    expect(screen.queryByRole("button", { name: "Save as package (.zip)" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add file…" }));
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
    pastePicture("image/jpeg");
    await waitFor(() => expect(screen.getByText("screenshot-1.jpg")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as package (.zip)" }));

    await waitFor(() => expect(rpcPayloads()).toHaveLength(1));
    const { method, params } = rpcPayloads()[0];
    expect(method).toBe("system.support_bundle");
    expect(params.attachments).toEqual(["C:/docs/broken.pdf"]);
    expect(params.images).toEqual([{ name: "screenshot-1.jpg", base64: useReportStore.getState().images[0].base64 }]);
    expect(JSON.stringify(params.texts)).toContain("Export breaks");
  });

  it("forgets attachments when the dialog closes", async () => {
    tauri.open.mockResolvedValueOnce("C:/docs/broken.pdf");
    render(<ReportDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Add file…" }));
    await waitFor(() => expect(useReportStore.getState().attachments).toEqual(["C:/docs/broken.pdf"]));

    useReportStore.getState().close();

    expect(useReportStore.getState()).toMatchObject({ attachments: [], images: [] });
  });
});
