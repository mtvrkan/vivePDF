import { Plus } from "lucide-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuButton } from "./MenuButton";

afterEach(cleanup);

describe("MenuButton", () => {
  it("opens its items under the button and runs the picked one", () => {
    const onSelect = vi.fn();
    render(<MenuButton icon={Plus} label="Insert" items={[{ type: "item", id: "formula", label: "Add formula", onSelect }]} />);
    const trigger = screen.getByRole("button", { name: "Insert" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add formula" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes again when the button is pressed a second time", () => {
    render(<MenuButton icon={Plus} label="Insert" items={[{ type: "item", id: "formula", label: "Add formula", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "Insert" });

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays shut while disabled", () => {
    render(<MenuButton icon={Plus} label="Insert" disabled items={[{ type: "item", id: "formula", label: "Add formula", onSelect: vi.fn() }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
