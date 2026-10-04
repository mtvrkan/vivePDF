import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { deleteFile } from "@/shared/rpc/files";
import { listPrinters, runPrint } from "@/shared/rpc/operations";
import { axeViolations } from "@/test/axe";
import { createDesign, createPage } from "../model/design";
import { exportDesign } from "./exportDesign";
import { useStudioStore } from "./studioStore";

vi.mock("@tauri-apps/api/path", () => ({ tempDir: async () => "C:/Temp", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@/shared/rpc/files", () => ({ deleteFile: vi.fn(async () => undefined) }));
vi.mock("@/shared/rpc/operations", () => ({
  listPrinters: vi.fn(async () => ({ printers: [{ name: "Office", isDefault: true }], default: "Office", backend: "windows" })),
  runPrint: vi.fn(async () => ({ printer: "Office", pages: 2, copies: 1, sheets: 2 })),
  studioSaveDraft: vi.fn(async () => ({ bytes: 1, savedAt: 1 })),
}));
vi.mock("./exportDesign", () => ({ exportDesign: vi.fn(async (params: { output: string }) => ({ output: params.output, outputs: [params.output], pageCount: 2, bytes: 1, missingGlyphs: "" })) }));

const { StudioPrintDialog } = await import("./StudioPrintDialog");

async function renderDialog(onClose = vi.fn()) {
  const view = render(<StudioPrintDialog open onClose={onClose} language="en" />);
  await screen.findByRole("combobox", { name: "Printer" });
  return { ...view, onClose };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.mocked(runPrint).mockClear();
  vi.mocked(listPrinters).mockClear();
  vi.mocked(exportDesign).mockClear();
  vi.mocked(deleteFile).mockClear();
  const design = createDesign("Cards", 100, 100);
  useStudioStore.getState().open({ ...design, pages: [design.pages[0], createPage(100, 100), createPage(100, 100)] });
});

afterEach(() => {
  cleanup();
  useStudioStore.getState().close();
});

describe("StudioPrintDialog", () => {
  it("renders the chosen pages to a temporary PDF, prints it and removes it", async () => {
    const { container, onClose } = await renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.change(screen.getByTestId("studio-export-range"), { target: { value: "2-3" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-print-run"));
    });

    const [params] = vi.mocked(exportDesign).mock.calls[0];
    expect(params).toMatchObject({ format: "pdf", pages: [2, 3], embed: false, dataPath: null });
    expect(params.output).toMatch(/^C:\/Temp\/vivepdf-studio-print-.+\.pdf$/);
    expect(vi.mocked(runPrint).mock.calls[0][0]).toMatchObject({ path: params.output, printer: "Office", copies: 1, scale: "fit", grayscale: false });
    expect(deleteFile).toHaveBeenCalledWith(params.output);
    expect(onClose).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("blocks printing while the custom range is wrong and says why", async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const input = screen.getByTestId("studio-export-range");

    fireEvent.change(input, { target: { value: "7" } });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("This design only has pages 1 to 3.")).toBeTruthy();
    expect((screen.getByTestId("studio-print-run") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a print failure in the dialog and still removes the temporary PDF", async () => {
    vi.mocked(runPrint).mockRejectedValueOnce({ code: "INTERNAL", message: "spooler stopped" });
    const { onClose } = await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-print-run"));
    });

    expect(screen.getByTestId("studio-print-error").textContent).toBeTruthy();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers a retry when the printers cannot be listed", async () => {
    vi.mocked(listPrinters).mockRejectedValueOnce({ code: "INTERNAL", message: "no spooler" });
    render(<StudioPrintDialog open onClose={vi.fn()} language="en" />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      fireEvent.click(retry);
    });

    expect(listPrinters).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("combobox", { name: "Printer" })).toBeTruthy();
  });
});
