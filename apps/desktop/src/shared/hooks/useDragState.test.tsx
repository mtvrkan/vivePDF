import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDragState } from "./useDragState";

describe("useDragState", () => {
  it("starts with no drag", () => {
    const { result } = renderHook(() => useDragState<{ index: number }>());

    expect(result.current[0]).toBeNull();
    expect(result.current[2].current).toBeNull();
  });

  it("exposes the newest drag at once, before the component renders again", () => {
    const { result } = renderHook(() => useDragState<{ index: number }>());
    const seen: Array<number | undefined> = [];

    act(() => {
      result.current[1]({ index: 1 });
      result.current[1]({ index: 2 });
      seen.push(result.current[2].current?.index);
    });

    expect(seen).toEqual([2]);
    expect(result.current[0]).toEqual({ index: 2 });
  });

  it("clears both the rendered and the latest drag", () => {
    const { result } = renderHook(() => useDragState<{ index: number }>());
    act(() => result.current[1]({ index: 3 }));

    act(() => result.current[1](null));

    expect(result.current[0]).toBeNull();
    expect(result.current[2].current).toBeNull();
  });
});
