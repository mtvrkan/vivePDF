import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresentationStore } from "@/shared/store/presentationStore";
import type { LiveSignal } from "@/features/viewer/presentation/liveSignal";
import { RemotePointerLayer } from "./RemotePointerLayer";

const RECTS = [{ pageIndex: 2, left: 160, top: 0, width: 1600, height: 900 }];

function signal(overrides: Partial<LiveSignal>): LiveSignal {
  return { tool: "laser", pageWidth: 400, pointer: { pageIndex: 2, x: 0.5, y: 0.25 }, laserPath: null, activeStroke: null, ...overrides };
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  usePresentationStore.getState().resetPrefs();
  usePresentationStore.setState({ laserSize: 8, spotlightRadius: 100, spotlightShape: "circle" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RemotePointerLayer", () => {
  it("puts the laser dot on the same spot of the page and scales it to the bigger screen", () => {
    render(<RemotePointerLayer signal={signal({})} rects={RECTS} />);

    const dot = document.querySelector<HTMLElement>("[data-remote-laser]") as HTMLElement;
    expect([dot.style.left, dot.style.top]).toEqual(["960px", "225px"]);
    expect(dot.style.width).toBe("32px");
  });

  it("follows the spotlight with a radius scaled to the audience page", () => {
    render(<RemotePointerLayer signal={signal({ tool: "spotlight" })} rects={RECTS} />);

    const spot = document.querySelector<HTMLElement>("[data-remote-spotlight]") as HTMLElement;
    expect([spot.style.left, spot.style.top, spot.style.width]).toEqual(["560px", "-175px", "800px"]);
  });

  it("shows nothing without a signal or for a page the audience has not laid out", () => {
    const { rerender } = render(<RemotePointerLayer signal={null} rects={RECTS} />);
    expect(document.querySelector("[data-remote-laser]")).toBeNull();

    rerender(<RemotePointerLayer signal={signal({ pointer: { pageIndex: 9, x: 0.5, y: 0.5 } })} rects={RECTS} />);
    expect(document.querySelector("[data-remote-laser]")).toBeNull();
  });

  it("lets a released laser stroke fade out instead of vanishing", () => {
    vi.useFakeTimers();
    const path = [
      { pageIndex: 2, x: 0.1, y: 0.1 },
      { pageIndex: 2, x: 0.3, y: 0.2 },
    ];
    const { rerender } = render(<RemotePointerLayer signal={signal({ laserPath: path })} rects={RECTS} />);
    expect(document.querySelectorAll("svg")).toHaveLength(1);

    rerender(<RemotePointerLayer signal={signal({ laserPath: null })} rects={RECTS} />);
    expect(document.querySelector("svg.laser-fade")).not.toBeNull();

    act(() => vi.advanceTimersByTime(800));
    expect(document.querySelector("svg")).toBeNull();
  });

  it("mirrors the presenter's plain cursor on the same spot of the page", () => {
    render(<RemotePointerLayer signal={signal({ tool: "pointer" })} rects={RECTS} />);

    const cursor = document.querySelector<SVGElement>("[data-remote-cursor]") as SVGElement;
    expect([cursor.style.left, cursor.style.top]).toEqual(["960px", "225px"]);
    expect(cursor.style.width).toBe("88px");
    expect(document.querySelector("[data-remote-laser]")).toBeNull();
  });

  it("hides the mirrored cursor when the presenter leaves the slide", () => {
    render(<RemotePointerLayer signal={signal({ tool: "pen", pointer: null })} rects={RECTS} />);

    expect(document.querySelector("[data-remote-cursor]")).toBeNull();
  });
});
