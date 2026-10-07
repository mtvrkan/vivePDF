import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganizerStore } from "./organizerStore";
import type { OrganizerEdits } from "./useOrganizerEdits";
import { useOrganizerShortcuts, type ShortcutCommands } from "./useOrganizerShortcuts";

const openPreview = vi.fn();
const applyAll = vi.fn();

function renderShortcuts() {
  const edits = { focusTileKey: () => "p2" } as unknown as OrganizerEdits;
  const commands = { openPreview, applyAll } as unknown as ShortcutCommands;
  renderHook(() => useOrganizerShortcuts({ enabled: true, layout: { columns: () => 4, clientBoxOf: () => null }, edits, commands }));
}

function press(key: string, target: EventTarget, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => {
  openPreview.mockReset();
  applyAll.mockReset();
  useOrganizerStore.setState({ tiles: [], selected: new Set(), anchor: null });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("organizer preview keys", () => {
  it("opens the focused page with Space or Enter on the page grid", () => {
    mount('<ol role="listbox" tabindex="0" id="grid"></ol>');
    renderShortcuts();
    const grid = document.getElementById("grid") as HTMLElement;

    const space = press(" ", grid);
    press("Enter", grid);

    expect(openPreview.mock.calls).toEqual([["p2"], ["p2"]]);
    expect(space.defaultPrevented).toBe(true);
  });

  it("lets Enter activate a focused toolbar button and keeps Ctrl+Enter for applying", () => {
    mount('<button type="button" id="rotate">Rotate</button>');
    renderShortcuts();
    const button = document.getElementById("rotate") as HTMLElement;

    const enter = press("Enter", button);
    press("Enter", button, { ctrlKey: true });

    expect(openPreview).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(applyAll).toHaveBeenCalledTimes(1);
  });

  it("lets Space tick the selection box of a page instead of opening the preview", () => {
    mount('<li data-tile-key="p3"><button type="button" role="checkbox" id="check"></button></li>');
    renderShortcuts();

    const space = press(" ", document.getElementById("check") as HTMLElement);

    expect(openPreview).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
  });

  it("lets Space press a focused toolbar button instead of opening the preview", () => {
    mount('<button type="button" id="undo">Undo</button>');
    renderShortcuts();

    const space = press(" ", document.getElementById("undo") as HTMLElement);

    expect(openPreview).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
  });

  it("leaves every key to an open menu", () => {
    mount('<div role="menu"><button type="button" role="menuitem" id="item">Rotate</button></div><div data-context-menu-layer><span id="layer"></span></div>');
    renderShortcuts();

    const enter = press("Enter", document.getElementById("item") as HTMLElement);
    const remove = press("Delete", document.getElementById("layer") as HTMLElement);

    expect(openPreview).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(remove.defaultPrevented).toBe(false);
  });

  it("inverts the selection with Ctrl+I", () => {
    const invertSelection = vi.fn();
    const edits = { focusTileKey: () => "p2", invertSelection } as unknown as OrganizerEdits;
    renderHook(() => useOrganizerShortcuts({ enabled: true, layout: { columns: () => 4, clientBoxOf: () => null }, edits, commands: {} as ShortcutCommands }));

    const event = press("i", document.body, { ctrlKey: true });

    expect(invertSelection).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores a key another handler already took", () => {
    mount('<ol role="listbox" tabindex="0" id="grid"></ol>');
    renderShortcuts();
    const grid = document.getElementById("grid") as HTMLElement;
    grid.addEventListener("keydown", (event) => event.preventDefault());

    press(" ", grid);

    expect(openPreview).not.toHaveBeenCalled();
  });
});
