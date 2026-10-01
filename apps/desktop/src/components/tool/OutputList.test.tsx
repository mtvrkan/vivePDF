import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputList } from "./OutputList";

const paths = (count: number) => Array.from({ length: count }, (_, index) => `C:/out/part-${index + 1}.pdf`);

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(36);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(360);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OutputList", () => {
  it("draws every file of a short result", () => {
    render(<OutputList outputs={paths(5)} onOpen={() => undefined} onReveal={() => undefined} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getAllByRole("listitem")[0].getAttribute("aria-setsize")).toBeNull();
  });

  it("draws only the rows in view of a long result and keeps their list positions", () => {
    render(<OutputList outputs={paths(1000)} onOpen={() => undefined} onReveal={() => undefined} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeLessThan(40);
    expect(rows[0].getAttribute("aria-posinset")).toBe("1");
    expect(rows[0].getAttribute("aria-setsize")).toBe("1000");
  });

  it("opens and reveals the file of the clicked row", () => {
    const onOpen = vi.fn();
    const onReveal = vi.fn();
    render(<OutputList outputs={paths(2)} onOpen={onOpen} onReveal={onReveal} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getAllByRole("button")[3]);
    expect(onOpen).toHaveBeenCalledWith("C:/out/part-1.pdf");
    expect(onReveal).toHaveBeenCalledWith("C:/out/part-2.pdf");
  });
});
