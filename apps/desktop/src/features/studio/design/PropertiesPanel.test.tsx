import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createShape, DEFAULT_DROP_SHADOW } from "../model/design";
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

describe("shape effects in the properties panel", () => {
  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("turns a drop shadow on for every selected shape and edits its blur together", () => {
    open([createShape("rect", 0, 0, 40, 40), createShape("ellipse", 60, 0, 40, 20)]);
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByRole("switch", { name: "Drop shadow" }));
    expect(shapes().map((element) => element.kind !== "text" && element.dropShadow)).toEqual([DEFAULT_DROP_SHADOW, DEFAULT_DROP_SHADOW]);

    fireEvent.change(screen.getByRole("slider", { name: "Blur" }), { target: { value: "20" } });
    expect(shapes().map((element) => element.kind !== "text" && element.dropShadow?.blur)).toEqual([20, 20]);
  });

  it("splits a rectangle's corners and edits one of them", () => {
    open([createShape("rect", 0, 0, 100, 100, { cornerRadius: 10 })]);
    render(<PropertiesPanel />);
    const toggle = screen.getByRole("button", { name: "Set each corner separately" });

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    const field = screen.getByRole("textbox", { name: /^Bottom right/ });
    fireEvent.change(field, { target: { value: "30" } });
    fireEvent.blur(field);

    expect(shapes()[0]).toMatchObject({ corners: [10, 10, 30, 10] });
    expect(screen.getByRole("button", { name: "Set each corner separately" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("swaps the heads of a line and hides fill for lines", () => {
    open([createShape("line", 0, 0, 100, 16, { endArrow: "arrow" })]);
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Swap ends" }));

    expect(shapes()[0]).toMatchObject({ startArrow: "arrow", endArrow: "none" });
    expect(screen.queryByText("Fill")).toBeNull();
  });
});
