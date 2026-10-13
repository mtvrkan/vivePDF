import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOutsideDismiss } from "./useOutsideDismiss";

function Panel({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(open, [ref], onDismiss);
  return (
    <>
      <div ref={ref}>
        <button type="button">inside</button>
      </div>
      <button type="button">outside</button>
    </>
  );
}

afterEach(cleanup);

describe("useOutsideDismiss", () => {
  it("dismisses an open panel on a press outside it", () => {
    const onDismiss = vi.fn();
    render(<Panel open onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the panel open for a press inside it", () => {
    const onDismiss = vi.fn();
    render(<Panel open onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "inside" }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does nothing while the panel is closed", () => {
    const onDismiss = vi.fn();
    render(<Panel open={false} onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
