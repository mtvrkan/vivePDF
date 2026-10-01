import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { focusableWithin, isTopmostModal, wrapTabFocus } from "./focusTrap";

afterEach(cleanup);

const always = () => true;

function tab(root: HTMLElement, shiftKey = false) {
  let prevented = false;
  const handled = wrapTabFocus({ key: "Tab", shiftKey, preventDefault: () => (prevented = true) }, root, always);
  return { handled, prevented };
}

function Panel() {
  return (
    <div data-testid="panel" tabIndex={-1}>
      <button type="button">first</button>
      <button type="button" disabled>
        disabled
      </button>
      <input aria-label="hidden input" type="hidden" />
      <div hidden>
        <button type="button">inside hidden</button>
      </div>
      <a href="#x">link</a>
      <span tabIndex={-1}>programmatic</span>
      <button type="button">last</button>
    </div>
  );
}

describe("focusableWithin", () => {
  it("lists only reachable controls in document order", () => {
    render(<Panel />);
    expect(focusableWithin(screen.getByTestId("panel"), always).map((element) => element.textContent)).toEqual(["first", "link", "last"]);
  });
});

describe("wrapTabFocus", () => {
  it("wraps from the last control to the first and back", () => {
    render(<Panel />);
    const panel = screen.getByTestId("panel");
    screen.getByText("last").focus();
    expect(tab(panel)).toEqual({ handled: true, prevented: true });
    expect(document.activeElement).toBe(screen.getByText("first"));
    expect(tab(panel, true)).toEqual({ handled: true, prevented: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("lets Tab move normally between inner controls", () => {
    render(<Panel />);
    screen.getByText("first").focus();
    expect(tab(screen.getByTestId("panel"))).toEqual({ handled: false, prevented: false });
  });

  it("pulls focus back in when it was lost to the body", () => {
    render(<Panel />);
    (document.activeElement as HTMLElement | null)?.blur();
    tab(screen.getByTestId("panel"));
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("ignores other keys", () => {
    render(<Panel />);
    expect(wrapTabFocus({ key: "Enter", shiftKey: false, preventDefault: () => undefined }, screen.getByTestId("panel"), always)).toBe(false);
  });
});

describe("isTopmostModal", () => {
  it("is true only for the last open modal", () => {
    render(
      <>
        <div role="dialog" aria-modal="true" data-testid="a" />
        <div role="dialog" aria-modal="true" data-testid="b" />
      </>,
    );
    expect(isTopmostModal(screen.getByTestId("a"))).toBe(false);
    expect(isTopmostModal(screen.getByTestId("b"))).toBe(true);
    expect(isTopmostModal(null)).toBe(false);
  });
});
