import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import type { DrawingSource } from "../drawing/drawingSource";
import { MERMAID_POINTS_PER_UNIT } from "./mermaidModel";

const { drawMermaid } = vi.hoisted(() => ({ drawMermaid: vi.fn() }));

vi.mock("./mermaidEngine", () => ({ drawMermaid: (code: string, theme: string) => drawMermaid(code, theme) }));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><text x="1" y="12">Start</text></svg>';

function mermaidOf(drawing: DrawingSource | undefined) {
  return drawing?.kind === "mermaid" ? drawing.source : undefined;
}

async function typeCode(value: string) {
  const input = await screen.findByRole("textbox", { name: "Mermaid code" });
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  return input as HTMLTextAreaElement;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  drawMermaid.mockReset();
  drawMermaid.mockImplementation(async (code: string) => (code.includes("-->") && !code.trim().endsWith("-->") ? { svg: SVG, width: 120, height: 60 } : { error: "invalid", message: "Parse error on line 2:\n...", line: 2 }));
  useViewerOverlayStore.getState().setMode("image");
});

afterEach(() => {
  cleanup();
  useViewerOverlayStore.getState().setMode(null);
});

describe("MermaidEditorHost", () => {
  it("draws a template and hands the diagram over for placing", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("mermaid", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add Mermaid diagram" })).toBeTruthy();
    expect(screen.getByText("No diagram yet")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Flowchart" }));
    });
    const preview = await screen.findByRole("img", { name: "Diagram preview: flowchart TD" }, { timeout: 3000 });
    expect(preview.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });

    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const pending = useViewerOverlayStore.getState().pendingImage;
    const source = mermaidOf(pending?.drawing);
    expect(source?.settings.code.startsWith("flowchart TD")).toBe(true);
    expect(source?.settings.theme).toBe("default");
    expect(source?.svg).toBe(SVG);
    expect(pending?.width).toBeCloseTo(120 * MERMAID_POINTS_PER_UNIT);
  });

  it("names the broken line and keeps Insert disabled until the code is fixed", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("mermaid", null);
    render(<DrawingEditorHost />);

    const input = await typeCode("flowchart TD\n  A -->");

    expect(await screen.findByText("This Mermaid code can't be read near line 2.", undefined, { timeout: 3000 })).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
    await typeCode("flowchart TD\n  A --> B");
    await screen.findByRole("img", { name: "Diagram preview: flowchart TD" }, { timeout: 3000 });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains code that reads but cannot be drawn", async () => {
    drawMermaid.mockResolvedValue({ error: "drawFailed", message: "", line: null });
    useViewerOverlayStore.getState().openDrawingEditor("mermaid", null);
    render(<DrawingEditorHost />);

    await typeCode("flowchart TD\n  A --> B");

    expect(await screen.findByText("This diagram couldn't be drawn.", undefined, { timeout: 3000 })).toBeTruthy();
    expect(drawMermaid).toHaveBeenCalledWith("flowchart TD\n  A --> B", "default");
  });
});
