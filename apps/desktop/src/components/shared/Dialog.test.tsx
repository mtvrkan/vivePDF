import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { Dialog } from "./Dialog";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10 }],
  });
});

afterEach(cleanup);

function Harness({ onClose = () => undefined, withSelectLike = false }: { onClose?: () => void; withSelectLike?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog
        open={open}
        title="Rename file"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={<button type="button">save</button>}
      >
        <label>
          Name
          <input defaultValue="report.pdf" />
        </label>
        {withSelectLike ? (
          <button
            type="button"
            onKeyDown={(event) => {
              if (event.key === "Escape") event.preventDefault();
            }}
          >
            listbox trigger
          </button>
        ) : null}
      </Dialog>
    </div>
  );
}

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  const target = document.activeElement ?? document.body;
  act(() => {
    fireEvent.keyDown(target, { key, ...init });
  });
}

describe("Dialog", () => {
  it("has no axe violations and names itself after its title", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog", { name: "Rename file" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("moves focus into the dialog, skipping the close button", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const save = screen.getByText("save");
    save.focus();
    press("Tab");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "common.close" }));
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByText("open");
    trigger.focus();
    fireEvent.click(trigger);
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves Escape to an inner control that already handled it", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} withSelectLike />);
    fireEvent.click(screen.getByText("open"));
    screen.getByText("listbox trigger").focus();
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes only the topmost of two stacked dialogs and keeps their title ids unique", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <>
        <Dialog open title="Outer" onClose={outerClose}>
          <input aria-label="outer field" />
        </Dialog>
        <Dialog open title="Inner" onClose={innerClose}>
          <input aria-label="inner field" />
        </Dialog>
      </>,
    );
    const titles = screen.getAllByRole("heading").map((heading) => heading.id);
    expect(new Set(titles).size).toBe(2);
    press("Escape");
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
