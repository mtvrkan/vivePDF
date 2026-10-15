import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore, type RulerState } from "@/shared/store/presentationStore";
import { PresentationRuler } from "./PresentationRuler";
import type { PageRect } from "./usePageRects";

const PAGE: PageRect = { pageIndex: 0, left: 100, top: 50, width: 800, height: 400 };
const RULER: RulerState = { pageIndex: 0, x: 0.1, y: 0.5, angle: 0, pageWidthPt: 600 };

function ruler() {
  return usePresentationStore.getState().ruler;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().setRuler(RULER);
});

afterEach(cleanup);

describe("PresentationRuler", () => {
  it("sits on its page edge with centimetre numbers and turns with the buttons", () => {
    render(<PresentationRuler rects={[PAGE]} interactive />);

    const body = screen.getByRole("group", { name: "On-screen ruler" });
    const frame = body.parentElement as HTMLElement;
    expect(frame.style.left).toBe("180px");
    expect(frame.style.top).toBe("250px");
    expect(screen.getByText("21")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rotate 15° right" }));
    expect(ruler()?.angle).toBe(15);
    fireEvent.click(screen.getByRole("button", { name: "Rotate 15° left" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate 15° left" }));
    expect(ruler()?.angle).toBe(-15);
    expect(document.querySelector("[data-ruler-angle]")?.textContent).toBe("-15°");
  });

  it("moves when dragged or nudged with the arrow keys", () => {
    render(<PresentationRuler rects={[PAGE]} interactive />);
    const body = screen.getByRole("group", { name: "On-screen ruler" });

    fireEvent.pointerDown(body, { button: 0, pointerId: 1, clientX: 300, clientY: 270 });
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 380, clientY: 310 });
    fireEvent.pointerUp(body, { pointerId: 1 });
    expect(ruler()?.x).toBeCloseTo(0.2);
    expect(ruler()?.y).toBeCloseTo(0.6);

    fireEvent.keyDown(body, { key: "ArrowLeft", shiftKey: true });
    expect(ruler()?.x).toBeCloseTo(0.15);
  });

  it("hides with its close button", () => {
    render(<PresentationRuler rects={[PAGE]} interactive />);

    fireEvent.click(screen.getByRole("button", { name: "Hide ruler" }));

    expect(ruler()).toBeNull();
    expect(document.querySelector("[data-presentation-ruler]")).toBeNull();
  });

  it("shows the audience a ruler they cannot move", () => {
    render(<PresentationRuler rects={[PAGE]} />);

    expect(document.querySelector("[data-presentation-ruler]")).not.toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing while its page is off screen", () => {
    act(() => usePresentationStore.getState().setRuler({ ...RULER, pageIndex: 5 }));

    render(<PresentationRuler rects={[PAGE]} interactive />);

    expect(document.querySelector("[data-presentation-ruler]")).toBeNull();
  });
});
