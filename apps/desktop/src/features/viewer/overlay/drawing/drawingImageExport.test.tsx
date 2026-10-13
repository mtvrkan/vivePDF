import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import { DrawingImageButton } from "./DrawingImageButton";
import { copyDrawingImage, drawingFileName, drawingPixelSize, saveDrawingImage } from "./drawingImageExport";
import type { DrawingImage, DrawingSource } from "./drawingSource";

const { saveDialog, drawingImage } = vi.hoisted(() => ({ saveDialog: vi.fn(), drawingImage: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (options: unknown) => saveDialog(options) }));
vi.mock("@/shared/rpc/operations", () => ({ drawingImage: (params: unknown) => drawingImage(params) }));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Dogs</text></svg>';
const mermaid: DrawingSource = { kind: "mermaid", source: { settings: { code: 'pie title Pets: "owned"/2026', theme: "default" }, svg: SVG, width: 10, height: 10 } };

function drawing(source: DrawingSource = mermaid): DrawingImage {
  return { id: "d", kind: "image", pageIndex: 0, x: 10, y: 20, width: 150, height: 60, dataUrl: "", path: null, aspect: 2.5, opacity: 0.5, drawing: source } as DrawingImage;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  saveDialog.mockReset();
  drawingImage.mockReset();
  drawingImage.mockImplementation(async (params: { output?: string }) => ({ output: params.output ?? null, width: 400, height: 160, bytes: 3, pngBase64: params.output ? null : btoa("png") }));
  useToastStore.setState({ toasts: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("drawing image export", () => {
  it("sizes the picture from the placed size and caps very large ones", () => {
    expect(drawingPixelSize(150, 60, 2)).toEqual({ width: 400, height: 160 });
    const capped = drawingPixelSize(14400, 14400, 8);
    expect(Math.max(capped.width, capped.height)).toBeLessThanOrEqual(12000);
    expect(capped.width * capped.height).toBeLessThanOrEqual(80_000_000);
  });

  it("names the file after the drawing without characters Windows refuses", () => {
    expect(drawingFileName(drawing(), i18n.t)).toBe("Diagram Pets owned 2026");
    const blank = drawing({ kind: "mermaid", source: { ...mermaid.source, settings: { code: "...", theme: "default" } } } as DrawingSource);
    expect(drawingFileName(blank, i18n.t)).toBe("Diagram");
  });

  it("saves next to the document in the format of the chosen file", async () => {
    saveDialog.mockResolvedValue("C:\\Docs\\chart.svg");

    const output = await saveDrawingImage({ item: drawing(), format: "png", scale: 4, documentPath: "C:\\Docs\\report.pdf", t: i18n.t });

    expect(saveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: "C:\\Docs\\Diagram Pets owned 2026.png" });
    expect(drawingImage).toHaveBeenCalledWith({ svg: SVG, width: 150, height: 60, format: "svg", scale: 4, output: "C:\\Docs\\chart.svg", overwrite: true });
    expect(output).toBe("C:\\Docs\\chart.svg");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null);

    expect(await saveDrawingImage({ item: drawing(), format: "png", scale: 2, documentPath: null, t: i18n.t })).toBeNull();
    expect(drawingImage).not.toHaveBeenCalled();
  });

  it("copies a PNG of the drawing to the clipboard", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly items: Record<string, Blob>) {}
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });

    await copyDrawingImage(drawing(), 1);

    expect(drawingImage).toHaveBeenCalledWith({ svg: SVG, width: 150, height: 60, format: "png", scale: 1 });
    const blob = (write.mock.calls[0][0][0] as { items: Record<string, Blob> }).items["image/png"];
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
  });

  it("offers PNG sizes, hides them for SVG and reports a failed save", async () => {
    saveDialog.mockResolvedValue("C:\\Docs\\a.png");
    drawingImage.mockRejectedValue({ code: "INVALID_PARAMS", message: "x" });
    const { container } = render(<DrawingImageButton item={drawing()} documentPath="C:\\Docs\\report.pdf" />);

    fireEvent.click(screen.getByRole("button", { name: "Save as picture" }));
    expect(screen.getByRole("dialog", { name: "Save drawing as picture" })).toBeTruthy();
    expect(screen.getByText("400 × 160 px")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "4×" }));
    expect(screen.getByText("800 × 320 px")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "SVG vector" }));
    expect(screen.queryByRole("radiogroup", { name: "Size" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    });

    await waitFor(() => expect(useToastStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(true));
    expect(drawingImage.mock.calls[0][0]).toMatchObject({ format: "png", scale: 4 });
    expect(screen.getByRole("dialog", { name: "Save drawing as picture" })).toBeTruthy();
  });
});
