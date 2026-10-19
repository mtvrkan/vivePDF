import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { HeaderMenu } from "./HeaderMenu";

function Harness() {
  const [openId, setOpenId] = useState<string | null>("tools");
  return (
    <MemoryRouter>
      <div data-testid="canvas" onPointerDown={(event) => event.stopPropagation()} />
      <HeaderMenu id="tools" label="Tools" active={false} openId={openId} onOpenChange={setOpenId}>
        <button type="button" role="menuitem">
          Merge
        </button>
      </HeaderMenu>
    </MemoryRouter>
  );
}

describe("HeaderMenu", () => {
  afterEach(cleanup);

  it("closes on a press elsewhere even when that area stops the event, as the page view does", () => {
    render(<Harness />);

    fireEvent.pointerDown(screen.getByTestId("canvas"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open for a press inside its own panel", () => {
    render(<Harness />);

    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Merge" }));

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes when the window loses focus or changes size, where its position would go stale", () => {
    render(<Harness />);
    fireEvent.blur(window);
    const afterBlur = screen.queryByRole("menu");
    cleanup();
    render(<Harness />);

    fireEvent(window, new Event("resize"));

    expect(afterBlur).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
