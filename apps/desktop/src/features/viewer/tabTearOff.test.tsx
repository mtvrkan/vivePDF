import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isOutsideViewport, useTabTearOff } from "./tabTearOff";

function Tab({ onTearOff, onActivate }: { onTearOff: (id: string) => void; onActivate: () => void }) {
  const tearOff = useTabTearOff(onTearOff);
  return (
    <div
      role="tab"
      data-dragging={tearOff.draggingId ?? ""}
      onPointerDown={(event) => tearOff.onPointerDown("doc-a", event)}
      onClick={() => {
        if (!tearOff.consumeDrag()) onActivate();
      }}
    >
      a.pdf
    </div>
  );
}

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  let captured = false;
  HTMLElement.prototype.setPointerCapture = vi.fn(() => {
    captured = true;
  });
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => captured);
  HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
    captured = false;
  });
  Object.assign(window, { innerWidth: 1000, innerHeight: 700 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isOutsideViewport", () => {
  it("tells points past any edge from points inside", () => {
    expect(isOutsideViewport(10, 10, 100, 100)).toBe(false);
    expect(isOutsideViewport(-1, 10, 100, 100)).toBe(true);
    expect(isOutsideViewport(10, -1, 100, 100)).toBe(true);
    expect(isOutsideViewport(100, 10, 100, 100)).toBe(true);
    expect(isOutsideViewport(10, 100, 100, 100)).toBe(true);
  });
});

describe("useTabTearOff", () => {
  it("moves the document out when the tab is dropped outside the window", () => {
    const onTearOff = vi.fn();
    const onActivate = vi.fn();
    render(<Tab onTearOff={onTearOff} onActivate={onActivate} />);
    const tab = screen.getByRole("tab");
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 60, 40);
    expect(tab.dataset.dragging).toBe("doc-a");
    pointer(tab, "pointerup", 1200, 300);
    fireEvent.click(tab);
    expect(onTearOff).toHaveBeenCalledWith("doc-a");
    expect(onActivate).not.toHaveBeenCalled();
    expect(tab.dataset.dragging).toBe("");
  });

  it("keeps the tab when the drag ends inside the window, without activating it", () => {
    const onTearOff = vi.fn();
    const onActivate = vi.fn();
    render(<Tab onTearOff={onTearOff} onActivate={onActivate} />);
    const tab = screen.getByRole("tab");
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 300, 200);
    pointer(tab, "pointerup", 300, 200);
    fireEvent.click(tab);
    expect(onTearOff).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("treats a press without movement as a click, even released outside", () => {
    const onTearOff = vi.fn();
    const onActivate = vi.fn();
    render(<Tab onTearOff={onTearOff} onActivate={onActivate} />);
    const tab = screen.getByRole("tab");
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 53, 12);
    pointer(tab, "pointerup", 53, 12);
    fireEvent.click(tab);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onTearOff).not.toHaveBeenCalled();
  });

  it("ignores a cancelled drag and other buttons", () => {
    const onTearOff = vi.fn();
    render(<Tab onTearOff={onTearOff} onActivate={vi.fn()} />);
    const tab = screen.getByRole("tab");
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 60, 400);
    pointer(tab, "pointercancel", -50, -50);
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 60, 400);
    pointer(tab, "lostpointercapture", -50, -50);
    pointer(tab, "pointerup", -50, -50);
    expect(tab.dataset.dragging).toBe("");
    fireEvent.pointerDown(tab, { button: 2, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
    pointer(tab, "pointermove", 60, 400);
    pointer(tab, "pointerup", -50, -50);
    expect(onTearOff).not.toHaveBeenCalled();
  });
});
