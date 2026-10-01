import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import type { DrawingSource } from "../drawing/drawingSource";
import { MOLECULE_POINTS_PER_UNIT } from "./moleculeModel";

function moleculeOf(drawing: DrawingSource | undefined) {
  return drawing?.kind === "molecule" ? drawing.source : undefined;
}

async function typeSmiles(value: string) {
  const input = await screen.findByRole("textbox", { name: "SMILES" });
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  return input as HTMLInputElement;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useViewerOverlayStore.getState().setMode("image");
});

afterEach(() => {
  cleanup();
  useViewerOverlayStore.getState().setMode(null);
});

describe("MoleculeEditorHost", () => {
  it("draws an example and hands the molecule over for placing", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("molecule", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add molecule" })).toBeTruthy();
    expect(screen.getByText("No molecule yet")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ethanol" }));
    });
    const preview = await screen.findByRole("img", { name: "Structure of CCO" }, { timeout: 3000 });
    expect(preview.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const pending = useViewerOverlayStore.getState().pendingImage;
    const source = moleculeOf(pending?.drawing);
    expect(source?.settings.smiles).toBe("CCO");
    expect(source?.svg).toContain("<text");
    expect(pending?.width).toBeCloseTo((source?.width ?? 0) * MOLECULE_POINTS_PER_UNIT);
  });

  it("explains a broken SMILES string and keeps Insert disabled until it is fixed", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("molecule", null);
    render(<DrawingEditorHost />);
    const input = await typeSmiles("C1CC(");
    expect(await screen.findByText("This SMILES string can't be read. Check the brackets, ring numbers and bonds.", undefined, { timeout: 3000 })).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
    await typeSmiles("C1CCCCC1");
    await screen.findByRole("img", { name: "Structure of C1CCCCC1" }, { timeout: 3000 });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
