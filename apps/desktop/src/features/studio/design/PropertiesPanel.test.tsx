import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createShape } from "../model/design";
import { PropertiesPanel } from "./PropertiesPanel";
import { useStudioStore } from "./studioStore";

function open(elements: ReturnType<typeof createShape>[]) {
  const design = createDesign("Multi", 400, 400);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements }] });
  useStudioStore.getState().select(elements.map((element) => element.id));
}

const shapes = () => useStudioStore.getState().design?.pages[0].elements ?? [];

describe("properties of several elements", () => {
  beforeEach(() => {
    open([
      createShape("rect", 0, 0, 40, 40, { opacity: 0.5, fill: { type: "solid", color: "#ff0000" }, stroke: { color: "#000000", width: 2, dash: "solid" } }),
      createShape("ellipse", 60, 0, 40, 20, { opacity: 1, fill: { type: "solid", color: "#00ff00" }, stroke: { color: "#000000", width: 6, dash: "solid" } }),
    ]);
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("marks values that differ as mixed and keeps shared ones", () => {
    render(<PropertiesPanel />);

    expect((screen.getByRole("textbox", { name: /^Opacity/ }) as HTMLInputElement).placeholder).toBe("Mixed");
    expect((screen.getByRole("textbox", { name: /^Rotation/ }) as HTMLInputElement).value).toBe("0");
    expect(screen.getByRole("button", { name: "Colour: Mixed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Outline colour: #000000" })).toBeTruthy();
    expect(screen.getByText("Fill")).toBeTruthy();
  });

  it("applies one opacity to every selected element in a single undo step", () => {
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByRole("slider", { name: "Opacity" }), { target: { value: "30" } });

    expect(shapes().map((element) => element.opacity)).toEqual([0.3, 0.3]);
    expect(useStudioStore.getState().past).toHaveLength(1);
  });

  it("changes only the edited stroke part on each element and can turn every outline off", () => {
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByRole("slider", { name: "Thickness" }), { target: { value: "4" } });
    expect(shapes().map((element) => element.kind === "shape" && element.stroke?.width)).toEqual([4, 4]);

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Outline" })).getByRole("radio", { name: "None" }));
    expect(shapes().map((element) => element.kind === "shape" && element.stroke)).toEqual([null, null]);
  });

  it("moves the selection as one box", () => {
    render(<PropertiesPanel />);
    const x = screen.getByRole("textbox", { name: /^X/ });

    fireEvent.change(x, { target: { value: "10" } });
    fireEvent.blur(x);

    const [first, second] = shapes();
    expect(second.x - first.x).toBeCloseTo(60);
    expect(first.x).toBeCloseTo(10 / (25.4 / 72));
  });

  it("shows nothing to edit for an empty selection beyond the page", () => {
    useStudioStore.getState().select([]);
    render(<PropertiesPanel />);

    expect(screen.queryByText("Copy style")).toBeNull();
  });
});
