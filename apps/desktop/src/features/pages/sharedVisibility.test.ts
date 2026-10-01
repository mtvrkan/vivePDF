import { afterEach, describe, expect, it, vi } from "vitest";
import { observeVisibility } from "./sharedVisibility";

type Callback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

const created: FakeObserver[] = [];

class FakeObserver {
  observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: Callback) {
    created.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
  }
}

describe("observeVisibility", () => {
  afterEach(() => {
    created.length = 0;
    vi.unstubAllGlobals();
  });

  it("shares one observer across elements and routes each entry to its own listener", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const first = {} as Element;
    const second = {} as Element;
    const seen: string[] = [];
    const stopFirst = observeVisibility(first, (visible) => seen.push(`first:${visible}`));
    const stopSecond = observeVisibility(second, (visible) => seen.push(`second:${visible}`));
    expect(created).toHaveLength(1);
    created[0].callback([{ target: second, isIntersecting: true }, { target: first, isIntersecting: false }]);
    expect(seen).toEqual(["second:true", "first:false"]);
    stopFirst();
    expect(created[0].disconnected).toBe(false);
    stopSecond();
    expect(created[0].disconnected).toBe(true);
  });

  it("ignores entries for elements that stopped listening", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const element = {} as Element;
    const listener = vi.fn();
    const keep = observeVisibility({} as Element, () => undefined);
    observeVisibility(element, listener)();
    created[0].callback([{ target: element, isIntersecting: true }]);
    expect(listener).not.toHaveBeenCalled();
    keep();
  });
});
