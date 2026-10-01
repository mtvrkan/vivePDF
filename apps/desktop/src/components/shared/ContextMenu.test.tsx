import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

afterEach(cleanup);

function press(element: Element) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

function renderMenu(onSelect = vi.fn(), onClose = vi.fn()) {
  const items: ContextMenuItem[] = [
    { type: "item", id: "copy", label: "Copy", onSelect: vi.fn() },
    { type: "submenu", id: "web", label: "Search the web", items: [{ type: "item", id: "bing", label: "Bing", onSelect }] },
  ];
  render(
    <>
      <button type="button">Outside</button>
      <ContextMenu anchor={{ x: 10, y: 10 }} items={items} label="Page" onClose={onClose} />
    </>,
  );
  return { onSelect, onClose };
}

describe("ContextMenu", () => {
  it("runs an item picked from a submenu instead of closing first", () => {
    const { onSelect, onClose } = renderMenu();
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Search the web" }));
    press(screen.getByRole("menuitem", { name: "Bing" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open while the pointer goes down on its own items", () => {
    const { onClose } = renderMenu();
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the pointer goes down outside every menu layer", () => {
    const { onSelect, onClose } = renderMenu();
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Search the web" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape even when focus has moved out of the menu", () => {
    const { onClose } = renderMenu();
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("marks checkable items with their state and leaves plain items as menu items", () => {
    const items: ContextMenuItem[] = [
      { type: "item", id: "single", label: "Single page", checked: true, onSelect: vi.fn() },
      { type: "item", id: "two", label: "Two pages", checked: false, onSelect: vi.fn() },
      { type: "item", id: "print", label: "Print", onSelect: vi.fn() },
    ];
    render(<ContextMenu anchor={{ x: 10, y: 10 }} items={items} label="Page display" onClose={vi.fn()} />);
    expect(screen.getByRole("menuitemcheckbox", { name: "Single page" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Two pages" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("menuitem", { name: "Print" }).hasAttribute("aria-checked")).toBe(false);
  });

  it("ignores other keys pressed outside the menu", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(screen.getByRole("button", { name: "Outside" }), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
