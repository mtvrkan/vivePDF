import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { OrganizerTile } from "@/types";
import { axeViolations } from "@/test/axe";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useOrganizerStore } from "./organizerStore";
import { OrganizerToolbar, type ToolbarCommands } from "./OrganizerToolbar";
import type { OrganizerEdits } from "./useOrganizerEdits";
import type { Inspection, PageInspections } from "./usePageInspections";

const TILES: OrganizerTile[] = [1, 2, 3].map((index) => ({ key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0 }));

function edits() {
  return { rotateSelected: vi.fn(), duplicateSelected: vi.fn(), deleteSelected: vi.fn(), deleteRelative: vi.fn(), reverseAll: vi.fn(), toggleCutsAtSelection: vi.fn(), setCuts: vi.fn(), selectAndReveal: vi.fn() } as unknown as OrganizerEdits;
}

function inspections(inspecting: Inspection | null, cancel = vi.fn()): PageInspections {
  return {
    inspecting,
    inspectionControl: (kind: Inspection, run: () => void = vi.fn()) => ({ busy: inspecting === kind, disabled: inspecting !== null && inspecting !== kind, onClick: inspecting === kind ? cancel : run }),
    selectByText: vi.fn(),
  } as PageInspections;
}

const commands = { openRange: vi.fn(), openDuplex: vi.fn(), openLabels: vi.fn(), openBlank: vi.fn(), pickPdf: vi.fn(), pickImages: vi.fn(), openShortcuts: vi.fn(), extractSelection: vi.fn(), pastePages: vi.fn(), openCopies: vi.fn(), openTextSelect: vi.fn() } satisfies ToolbarCommands;

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

  it("remembers where new pages go and marks the chosen place", () => {
    renderToolbar(edits(), inspections(null));

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Insert new pages/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Before the selection/ }));

    expect(useUiStore.getState().pagesInsertPlace).toBe("before");
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Insert new pages/ }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Before the selection/ }).getAttribute("aria-checked")).toBe("true");
    useUiStore.getState().setPagesInsertPlace("after");
  });

  it("selects pages by orientation and by paper size from the known page sizes", () => {
    const organizerEdits = edits();
    useOrganizerStore.setState({ documentId: "doc", sources: {} });
    useDocumentStore.setState({ documents: { doc: { info: { pageSizes: [{ width: 595, height: 842, rotation: 0 }, { width: 842, height: 595, rotation: 0 }, { width: 612, height: 792, rotation: 0 }] } } } as never });
    renderToolbar(organizerEdits, inspections(null));

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Landscape pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /By page size/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "A4 · 210 × 297 mm (2)" }));

    expect(organizerEdits.selectAndReveal).toHaveBeenNthCalledWith(1, ["p2"]);
    expect(organizerEdits.selectAndReveal).toHaveBeenNthCalledWith(2, ["p1", "p2"]);
    expect(screen.queryByRole("menuitem", { name: /Letter/ })).toBeNull();
    useDocumentStore.setState({ documents: {} });
  });

  it("opens the text search and offers to cancel it while it runs", () => {
    const cancel = vi.fn();
    renderToolbar(edits(), inspections(null));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Select by text/ }));
    cleanup();

    renderToolbar(edits(), inspections("text", cancel));
    fireEvent.click(screen.getByRole("button", { name: /Inspecting pages/ }));

    expect(commands.openTextSelect).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
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
