import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { SplitDivider } from "./SplitDivider";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

function renderDivider(layout: "columns" | "rows", ratio: number) {
  const onRatioChange = vi.fn();
  const containerRef = createRef<HTMLDivElement>();
  const view = render(
    <div ref={containerRef}>
      <SplitDivider layout={layout} ratio={ratio} containerRef={containerRef} onRatioChange={onRatioChange} />
    </div>,
  );
  return { onRatioChange, container: view.container };
}

describe("SplitDivider", () => {
  it("announces its position and moves with the arrow keys", async () => {
    const { onRatioChange, container } = renderDivider("columns", 0.5);
    const divider = screen.getByRole("separator", { name: "Resize the split" });
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider.getAttribute("aria-valuenow")).toBe("50");

    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    fireEvent.keyDown(divider, { key: "End" });
    expect(onRatioChange.mock.calls.map(([value]) => Number(value.toFixed(2)))).toEqual([0.45, 0.8]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("uses the vertical arrows when the panes are stacked", () => {
    const { onRatioChange } = renderDivider("rows", 0.4);
    const divider = screen.getByRole("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");

    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(onRatioChange).toHaveBeenCalledTimes(1);
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.45);
  });

  it("ignores pointer moves without a captured drag", () => {
    const { onRatioChange } = renderDivider("columns", 0.5);
    fireEvent.pointerMove(screen.getByRole("separator"), { clientX: 10, pointerId: 1 });
    expect(onRatioChange).not.toHaveBeenCalled();
  });
});
