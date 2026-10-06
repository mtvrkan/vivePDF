import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { defaultHomeLayout } from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";
import { QuickActions } from "./QuickActions";

const tile = (id: string) => document.querySelector(`[data-quick-action="${id}"]`) as HTMLElement;
const order = () => Array.from(document.querySelectorAll<HTMLElement>("[data-quick-action]")).map((item) => item.dataset.quickAction);

function pointAt(id: string) {
  document.elementFromPoint = vi.fn(() => tile(id).firstElementChild);
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  useHomeLayoutStore.setState({ layout: defaultHomeLayout(), editing: true });
});

afterEach(cleanup);

describe("QuickActions", () => {
  it("drags a tile onto another one, shows the new place while moving and saves it on release", () => {
    render(<QuickActions editing />, { wrapper: MemoryRouter });

    fireEvent.pointerDown(tile("merge"), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    pointAt("images-to-pdf");
    fireEvent.pointerMove(tile("merge"), { pointerId: 1, clientX: 300, clientY: 10 });
    expect(order()).toEqual(["split", "compress", "images-to-pdf", "merge", "docx", "pages"]);
    expect(useHomeLayoutStore.getState().layout.quickActions[0]).toBe("merge");

    fireEvent.pointerUp(tile("merge"), { pointerId: 1 });
    expect(useHomeLayoutStore.getState().layout.quickActions).toEqual(["split", "compress", "images-to-pdf", "merge", "docx", "pages"]);
  });

  it("does not start a drag from the tile's remove button", () => {
    render(<QuickActions editing />, { wrapper: MemoryRouter });
    const remove = screen.getByRole("button", { name: "Remove Merge from quick access" });

    fireEvent.pointerDown(remove, { button: 0, pointerId: 1 });
    pointAt("pages");
    fireEvent.pointerMove(tile("merge"), { pointerId: 1 });
    fireEvent.pointerUp(tile("merge"), { pointerId: 1 });

    expect(useHomeLayoutStore.getState().layout.quickActions).toEqual(defaultHomeLayout().quickActions);
  });

  it("puts the tiles back when the drag is cancelled", () => {
    render(<QuickActions editing />, { wrapper: MemoryRouter });

    fireEvent.pointerDown(tile("split"), { button: 0, pointerId: 1 });
    pointAt("pages");
    fireEvent.pointerMove(tile("split"), { pointerId: 1 });
    fireEvent.pointerCancel(tile("split"), { pointerId: 1 });

    expect(order()).toEqual(defaultHomeLayout().quickActions);
    expect(useHomeLayoutStore.getState().layout.quickActions).toEqual(defaultHomeLayout().quickActions);
  });

  it("moves a tile with the arrow keys and shows no arrow buttons", () => {
    render(<QuickActions editing />, { wrapper: MemoryRouter });

    expect(screen.queryByRole("button", { name: /earlier|later/ })).toBeNull();
    fireEvent.keyDown(tile("merge").firstElementChild as HTMLElement, { key: "ArrowRight" });
    expect(useHomeLayoutStore.getState().layout.quickActions.slice(0, 2)).toEqual(["split", "merge"]);
    fireEvent.keyDown(tile("merge").firstElementChild as HTMLElement, { key: "ArrowLeft" });
    expect(useHomeLayoutStore.getState().layout.quickActions[0]).toBe("merge");
  });
});

