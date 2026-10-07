import { act, cleanup, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passedDragThreshold, useTileDrag } from "./useTileDrag";
import { tileClickAction } from "./tileSelection";

const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
const onMove = vi.fn();

function pointer(type: string, x: number, y: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
}

function renderDrag(selected: string[] = []) {
  return renderHook(() => useTileDrag({ scrollRef: { current: null }, dropIndexAt: () => 3, selectedKeys: new Set(selected), onMove }));
}

function pressOn(drag: ReturnType<typeof renderDrag>, key: string, x: number, y: number) {
  drag.result.current.onTilePointerDown({ button: 0, clientX: x, clientY: y } as ReactPointerEvent, key);
}

beforeEach(() => {
  onMove.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("passedDragThreshold", () => {
  it("treats a small jitter as part of a click", () => {
    expect(passedDragThreshold(10, 10, 13, 14)).toBe(false);
  });

  it("starts a drag once the pointer has moved six pixels", () => {
    expect(passedDragThreshold(10, 10, 16, 10)).toBe(true);
    expect(passedDragThreshold(10, 10, 10, 2)).toBe(true);
  });
});

describe("useTileDrag click and drag", () => {
  it("lets a press and release without movement through as a selecting click", () => {
    const drag = renderDrag();

    act(() => {
      pressOn(drag, "p1", 10, 10);
      pointer("pointermove", 12, 11);
      pointer("pointerup", 12, 11);
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(drag.result.current.wasDragged()).toBe(false);
    expect(tileClickAction(plain, false, drag.result.current.wasDragged())).toEqual({ kind: "select", mode: "replace" });
  });

  it("moves the tile and swallows the click that ends a drag", async () => {
    const drag = renderDrag();

    act(() => {
      pressOn(drag, "p1", 10, 10);
      pointer("pointermove", 60, 40);
      pointer("pointerup", 60, 40);
    });

    expect(onMove).toHaveBeenCalledWith(new Set(["p1"]), 3);
    expect(tileClickAction(plain, false, drag.result.current.wasDragged())).toEqual({ kind: "none" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(drag.result.current.wasDragged()).toBe(false);
  });

  it("drags the whole selection when the pressed tile is part of it", () => {
    const drag = renderDrag(["p1", "p2"]);

    act(() => {
      pressOn(drag, "p2", 10, 10);
      pointer("pointermove", 80, 10);
      pointer("pointerup", 80, 10);
    });

    expect(onMove).toHaveBeenCalledWith(new Set(["p1", "p2"]), 3);
  });
});
