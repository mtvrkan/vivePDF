import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createPage } from "../model/design";
import { exportDesign } from "./exportDesign";
import { EXPORT_SETTINGS_KEY } from "./exportSettings";
import { useStudioStore } from "./studioStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ studioSaveDraft: vi.fn(async () => ({ bytes: 1, savedAt: 1 })) }));
vi.mock("@/shared/lib/paths", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/shared/lib/paths")>()), defaultOutputDirectory: async () => "C:/out" }));
vi.mock("./exportDesign", () => ({ exportDesign: vi.fn(async () => ({ output: "C:/out/Cards-2.png", outputs: ["C:/out/Cards-2.png"], pageCount: 1, bytes: 1, missingGlyphs: "" })) }));

const { ExportDialog } = await import("./ExportDialog");

async function renderDialog() {
  const view = render(
    <MemoryRouter>
      <ExportDialog open onClose={vi.fn()} language="en" />
    </MemoryRouter>,
  );
  await act(async () => undefined);
  return view;
}

function choice(group: string, name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });
}

function runButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Export" }) as HTMLButtonElement;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(exportDesign).mockClear();
  localStorage.clear();
  const design = createDesign("Cards", 100, 100);
  const third = { ...createPage(100, 100), background: { fill: { type: "none" as const }, image: null } };
  useStudioStore.getState().open({ ...design, pages: [design.pages[0], createPage(100, 100), third] });
});

afterEach(() => {
  cleanup();
  useStudioStore.getState().close();
});

describe("ExportDialog", () => {
  it("exports the typed pages as numbered pictures and remembers the settings", async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "PNG" }));
    fireEvent.click(choice("Pages", "Custom"));
    fireEvent.change(screen.getByTestId("studio-export-range"), { target: { value: "2-3" } });
    fireEvent.click(screen.getByRole("radio", { name: "300 dpi" }));
    fireEvent.click(screen.getByRole("switch", { name: "See-through background" }));

    expect(screen.getByTestId("studio-export-files").textContent).toContain("Cards-2.png … Cards-3.png");
    await act(async () => {
      fireEvent.click(runButton());
    });

    expect(vi.mocked(exportDesign).mock.calls[0][0]).toMatchObject({ format: "png", pages: [2, 3], dpi: 300, transparent: true, output: "C:/out/Cards.png" });
    expect(JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? "{}")).toMatchObject({ format: "png", dpi: 300, transparent: true });
  });

  it("starts from the remembered settings", async () => {
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ format: "jpg", dpi: 96, quality: 40, transparent: false, embed: true }));

    await renderDialog();

    expect(screen.getByRole("radio", { name: "JPG" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("studio-export-dpi") as HTMLInputElement).value).toBe("96");
    expect(screen.getByText("40")).toBeTruthy();
  });

  it("explains a wrong page range or resolution inline and blocks the export", async () => {
    await renderDialog();
    fireEvent.click(choice("Pages", "Custom"));
    const range = screen.getByTestId("studio-export-range");

    fireEvent.change(range, { target: { value: "1,,2" } });
    expect(range.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Use page numbers and ranges such as 1-3, 5.")).toBeTruthy();
    expect(runButton().disabled).toBe(true);

    fireEvent.change(range, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("radio", { name: "JPG" }));
    fireEvent.click(choice("Resolution", "Custom"));
    fireEvent.change(screen.getByTestId("studio-export-dpi"), { target: { value: "5000" } });
    expect(screen.getByText("Enter a resolution from 36 to 600 dpi.")).toBeTruthy();
    expect(runButton().disabled).toBe(true);
  });
});
