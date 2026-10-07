import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { OrganizerTile } from "@/types";
import { axeViolations } from "@/test/axe";
import { useOrganizerStore } from "./organizerStore";
import { OrganizerToolbar, type ToolbarCommands } from "./OrganizerToolbar";
import type { OrganizerEdits } from "./useOrganizerEdits";
import type { Inspection, PageInspections } from "./usePageInspections";

const TILES: OrganizerTile[] = [1, 2, 3].map((index) => ({ key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0 }));

function edits() {
  return { rotateSelected: vi.fn(), duplicateSelected: vi.fn(), deleteSelected: vi.fn(), deleteRelative: vi.fn(), reverseAll: vi.fn(), toggleCutsAtSelection: vi.fn(), setCuts: vi.fn() } as unknown as OrganizerEdits;
}

function inspections(inspecting: Inspection | null, cancel = vi.fn()): PageInspections {
  return {
    inspecting,
    inspectionControl: (kind: Inspection) => ({ busy: inspecting === kind, disabled: inspecting !== null && inspecting !== kind, onClick: inspecting === kind ? cancel : vi.fn() }),
  } as PageInspections;
}

const commands = { openRange: vi.fn(), openDuplex: vi.fn(), openLabels: vi.fn(), openBlank: vi.fn(), pickPdf: vi.fn(), pickImages: vi.fn(), openShortcuts: vi.fn(), extractSelection: vi.fn(), pastePages: vi.fn() } satisfies ToolbarCommands;

function renderToolbar(organizerEdits: OrganizerEdits, pageInspections: PageInspections) {
  return render(<OrganizerToolbar edits={organizerEdits} inspections={pageInspections} commands={commands} multiSelect={false} pasting={false} onToggleMultiSelect={vi.fn()} zoom={160} onZoom={vi.fn()} />);
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useOrganizerStore.setState({ tiles: TILES, selected: new Set(["p2"]), anchor: "p2", cuts: new Set(), past: [], future: [] });
});

afterEach(cleanup);

describe("OrganizerToolbar", () => {
  it("groups the page actions behind four labelled menus and passes an accessibility check", async () => {
    const { container } = renderToolbar(edits(), inspections(null));

    for (const name of ["Select", "Insert", "Edit pages", "Split"]) expect(screen.getByRole("button", { name }).getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("button", { name: "Rotate right" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("runs a page action chosen from its menu", () => {
    const organizerEdits = edits();
    renderToolbar(organizerEdits, inspections(null));

    fireEvent.click(screen.getByRole("button", { name: "Edit pages" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rotate right/ }));

    expect(organizerEdits.rotateSelected).toHaveBeenCalledWith(90);
  });

  it("blocks other page checks while one runs and offers to cancel it", () => {
    const cancel = vi.fn();
    renderToolbar(edits(), inspections("blank", cancel));

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect((screen.getByRole("menuitem", { name: /Select scanned pages/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Inspecting pages/ }));

    expect(cancel).toHaveBeenCalled();
  });
});
