import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioFill } from "@/types/studio";
import { GradientEditor } from "./GradientEditor";

afterEach(cleanup);

const LINEAR: StudioFill = { type: "linear", angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] };

function setup(value: StudioFill = LINEAR) {
  const onChange = vi.fn();
  render(<GradientEditor value={value as Extract<StudioFill, { type: "linear" | "radial" }>} onChange={onChange} />);
  return onChange;
}

describe("GradientEditor", () => {
  it("adds a stop in the widest gap, keeps two stops at least and reverses the colours", () => {
    const onChange = setup();

    expect((screen.getByRole("button", { name: "studio.gradient.remove" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "studio.gradient.add" }));
    fireEvent.click(screen.getByRole("button", { name: "studio.gradient.reverse" }));

    expect(onChange.mock.calls[0][0].stops).toEqual([{ offset: 0, color: "#000000" }, { offset: 0.5, color: "#808080" }, { offset: 1, color: "#ffffff" }]);
    expect(onChange.mock.calls[1][0].stops.map((stop: { color: string }) => stop.color)).toEqual(["#ffffff", "#000000"]);
  });

  it("moves the chosen stop with the keyboard and turns the angle dial", () => {
    const onChange = setup();
    const [first] = screen.getAllByRole("slider", { name: /studio\.gradient\.stop/ });

    fireEvent.keyDown(first, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("slider", { name: "studio.fill.angle" }), { key: "ArrowLeft" });

    expect(onChange.mock.calls[0]).toEqual([{ ...LINEAR, stops: [{ offset: 0.1, color: "#000000" }, LINEAR.type === "linear" ? LINEAR.stops[1] : null] }, "fill-stop-move"]);
    expect(onChange.mock.calls[1]).toEqual([expect.objectContaining({ angle: 89 }), "fill-angle"]);
  });

  it("offers centre and size for radial gradients instead of an angle", () => {
    const onChange = setup({ type: "radial", stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] });

    expect(screen.queryByRole("slider", { name: "studio.fill.angle" })).toBeNull();
    fireEvent.change(screen.getByRole("slider", { name: "studio.gradient.radius" }), { target: { value: "150" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "radial", radius: 1.5 }), "fill-radius");
  });
});
