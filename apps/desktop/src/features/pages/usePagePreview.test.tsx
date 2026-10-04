import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerTile } from "@/types";
import { useOrganizerStore } from "./organizerStore";
import { useOrganizerEdits } from "./useOrganizerEdits";
import { usePagePreview } from "./usePagePreview";

function page(index: number): OrganizerTile {
  return { key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0 };
}

const reveal = vi.fn();

function renderPreview() {
  return renderHook(() => usePagePreview(useOrganizerEdits(reveal)));
}

const selection = () => [...useOrganizerStore.getState().selected].sort();

beforeEach(() => {
  reveal.mockReset();
  useOrganizerStore.setState({ tiles: [page(1), page(2), page(3), page(4), page(5)], selected: new Set(["p1", "p4"]), anchor: "p1" });
});

afterEach(cleanup);

describe("usePagePreview", () => {
  it("opens a page without touching the selection and moves the grid focus to it", () => {
    const { result } = renderPreview();

    act(() => result.current.open("p2"));

    expect(result.current.previewKey).toBe("p2");
    expect(selection()).toEqual(["p1", "p4"]);
    expect(useOrganizerStore.getState().anchor).toBe("p2");
  });

  it("selects and deselects the previewed page in the shared organizer selection", () => {
    const { result } = renderPreview();
    act(() => result.current.open("p2"));

    act(() => result.current.toggle());
    expect(selection()).toEqual(["p1", "p2", "p4"]);

    act(() => result.current.toggle());
    expect(selection()).toEqual(["p1", "p4"]);
  });

  it("browses with the arrows while keeping the pages picked so far", () => {
    const { result } = renderPreview();
    act(() => result.current.open("p2"));
    act(() => result.current.toggle());

    act(() => result.current.step(1, false));

    expect(result.current.previewKey).toBe("p3");
    expect(selection()).toEqual(["p1", "p2", "p4"]);
    expect(useOrganizerStore.getState().anchor).toBe("p3");
    expect(reveal).toHaveBeenLastCalledWith(2);
  });

  it("extends the selection with Shift and shrinks it again when stepping back", () => {
    useOrganizerStore.setState({ selected: new Set(), anchor: null });
    const { result } = renderPreview();
    act(() => result.current.open("p2"));

    act(() => result.current.step(1, true));
    act(() => result.current.step(1, true));
    expect(result.current.previewKey).toBe("p4");
    expect(selection()).toEqual(["p2", "p3", "p4"]);

    act(() => result.current.step(-1, true));
    expect(result.current.previewKey).toBe("p3");
    expect(selection()).toEqual(["p2", "p3"]);
  });

  it("stays on the last page instead of wrapping or changing the selection", () => {
    const { result } = renderPreview();
    act(() => result.current.open("p5"));

    act(() => result.current.step(1, true));

    expect(result.current.previewKey).toBe("p5");
    expect(selection()).toEqual(["p1", "p4"]);
  });

  it("ignores a toggle after the previewed page was removed", () => {
    const { result } = renderPreview();
    act(() => result.current.open("p2"));
    act(() => useOrganizerStore.setState({ tiles: [page(1), page(3)] }));

    act(() => result.current.toggle());

    expect(selection()).toEqual(["p1", "p4"]);
  });
});
