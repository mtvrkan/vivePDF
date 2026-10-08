import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createShape } from "../model/design";
import { cursorFor } from "./canvasGeometry";
import { SelectionOverlay } from "./SelectionOverlay";

const handles = () => [...document.querySelectorAll<HTMLElement>("[data-handle]")].filter((node) => node.dataset.handle !== "rotate");

function overlay(width: number, height: number, rotation = 0) {
  render(<SelectionOverlay selected={[{ ...createShape("rect", 10, 10, width, height), rotation }]} zoom={1} turn={null} showHandles cropping={false} />);
}

describe("selection handles", () => {
  afterEach(cleanup);

  it("shows all eight handles on a roomy element", () => {
    overlay(120, 80);

    expect(handles().map((node) => node.dataset.handle).sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });

  it("puts only the corners outside a tiny element so its body stays draggable", () => {
    overlay(20, 12);

    const shown = handles();
    expect(shown.map((node) => node.dataset.handle).sort()).toEqual(["ne", "nw", "se", "sw"]);
    const nw = shown.find((node) => node.dataset.handle === "nw");
    expect(Number.parseFloat(nw?.style.left ?? "0")).toBeLessThan(-6);
  });

  it("turns the resize cursor with the element", () => {
    expect(cursorFor("e", 0)).toBe("ew-resize");
    expect(cursorFor("e", 90)).toBe("ns-resize");
    expect(cursorFor("e", 45)).toBe("nwse-resize");
    expect(cursorFor("n", -45)).toBe("nwse-resize");
    overlay(120, 80, 90);

    expect(handles().find((node) => node.dataset.handle === "e")?.style.cursor).toBe("ns-resize");
  });
});
