import { describe, expect, it, vi } from "vitest";
import { outsideRender } from "@/shared/lib/outsideRender";
import { trackSessionAnnotation } from "./sessionAnnotations";

describe("trackSessionAnnotation", () => {
  it("adds created annotations once", () => {
    const first = trackSessionAnnotation([], { type: "create", pageIndex: 2, annotation: { id: "a" } });
    expect(first).toEqual([{ pageIndex: 2, id: "a" }]);
    expect(trackSessionAnnotation(first, { type: "create", pageIndex: 2, annotation: { id: "a" } })).toBe(first);
  });

  it("drops deleted annotations and ignores unknown ones", () => {
    const list = [
      { pageIndex: 0, id: "a" },
      { pageIndex: 1, id: "b" },
    ];
    expect(trackSessionAnnotation(list, { type: "delete", pageIndex: 0, annotation: { id: "a" } })).toEqual([{ pageIndex: 1, id: "b" }]);
    expect(trackSessionAnnotation(list, { type: "delete", pageIndex: 0, annotation: { id: "zzz" } })).toBe(list);
  });

  it("ignores updates", () => {
    const list = [{ pageIndex: 0, id: "a" }];
    expect(trackSessionAnnotation(list, { type: "update", pageIndex: 0, annotation: { id: "a" } })).toBe(list);
  });
});

describe("outsideRender", () => {
  it("runs the update after the current synchronous work, never inside it", async () => {
    const update = vi.fn();
    outsideRender(update);
    expect(update).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
