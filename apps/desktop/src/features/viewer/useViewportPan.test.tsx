import { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { useViewportPan } from "./useViewportPan";

function Pane({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewportPan(ref);
  return (
    <div ref={ref} data-testid={name}>
      <div data-pan-scroller data-testid={`${name}-scroller`} tabIndex={-1} />
    </div>
  );
}

const scrollBy = vi.fn();

function scrollerOf(name: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-testid="${name}-scroller"]`) as HTMLElement;
}

function tapSpace() {
  fireEvent.keyDown(window, { code: "Space", key: " " });
  fireEvent.keyUp(window, { code: "Space", key: " " });
}

function scrolledPanes(): string[] {
  return scrollBy.mock.contexts.map((context) => (context as HTMLElement).dataset.testid ?? "");
}

beforeEach(() => {
  scrollBy.mockReset();
  Element.prototype.scrollBy = scrollBy as unknown as typeof Element.prototype.scrollBy;
  useViewerOverlayStore.setState({ mode: null });
  useUiStore.setState({ immersive: false });
});

afterEach(cleanup);

describe("useViewportPan space handling", () => {
  it("scrolls the only pane when no pane was touched yet", () => {
    render(<Pane name="solo" />);

    tapSpace();

    expect(scrolledPanes()).toEqual(["solo-scroller"]);
  });

  it("scrolls only the pane the pointer last entered in split view", () => {
    const view = render(
      <>
        <Pane name="left" />
        <Pane name="right" />
      </>,
    );

    fireEvent.pointerEnter(view.getByTestId("right"));
    tapSpace();

    expect(scrolledPanes()).toEqual(["right-scroller"]);
  });

  it("prefers the pane that owns keyboard focus over the last pointer", () => {
    const view = render(
      <>
        <Pane name="left" />
        <Pane name="right" />
      </>,
    );
    fireEvent.pointerEnter(view.getByTestId("right"));
    scrollerOf("left").focus();

    tapSpace();

    expect(scrolledPanes()).toEqual(["left-scroller"]);
  });

  it("ignores space while a modal dialog is open", () => {
    render(<Pane name="solo" />);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    tapSpace();
    dialog.remove();

    expect(scrollBy).not.toHaveBeenCalled();
  });
});
