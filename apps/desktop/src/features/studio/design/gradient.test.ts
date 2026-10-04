import { describe, expect, it } from "vitest";
import { MAX_GRADIENT_STOPS } from "../model/design";
import { addStop, colorAt, gradientCss, moveStop, removeStop, reverseStops, setStopColor, widestGapMiddle } from "./gradient";

const BLACK_TO_WHITE = [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }];

describe("gradient stop editing", () => {
  it("adds a stop in the colour the gradient already has at that point", () => {
    const added = addStop(BLACK_TO_WHITE, 0.5);

    expect(added).toEqual({ stops: [BLACK_TO_WHITE[0], { offset: 0.5, color: "#808080" }, BLACK_TO_WHITE[1]], index: 1 });
    expect(colorAt(BLACK_TO_WHITE, -1)).toBe("#000000");
    expect(colorAt(BLACK_TO_WHITE, 2)).toBe("#ffffff");
  });

  it("keeps stops in order while one is dragged past another and follows the dragged one", () => {
    const three = [...BLACK_TO_WHITE, { offset: 0.5, color: "#ff0000" }];
    const moved = moveStop(three, 0, 0.75);

    expect(moved.stops.map((stop) => stop.color)).toEqual(["#ff0000", "#000000", "#ffffff"]);
    expect(moved.index).toBe(1);
    expect(moveStop(BLACK_TO_WHITE, 1, 4).stops[1].offset).toBe(1);
  });

  it("never drops below two stops or goes past the model limit", () => {
    expect(removeStop(BLACK_TO_WHITE, 0)).toEqual({ stops: BLACK_TO_WHITE, index: 0 });
    const full = Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) => ({ offset: index / (MAX_GRADIENT_STOPS - 1), color: "#123456" }));
    expect(addStop(full, 0.5)).toBeNull();
    expect(removeStop([...BLACK_TO_WHITE, { offset: 1, color: "#ff0000" }], 2)).toEqual({ stops: BLACK_TO_WHITE, index: 1 });
  });

  it("recolours, reverses and finds room for a new stop", () => {
    expect(setStopColor(BLACK_TO_WHITE, 1, "#ff0000")[1].color).toBe("#ff0000");
    expect(reverseStops([{ offset: 0.2, color: "#000000" }, { offset: 1, color: "#ffffff" }])).toEqual([{ offset: 0, color: "#ffffff" }, { offset: 0.8, color: "#000000" }]);
    expect(widestGapMiddle([{ offset: 0, color: "#000000" }, { offset: 0.2, color: "#000000" }, { offset: 1, color: "#ffffff" }])).toBe(0.6);
  });

  it("previews a single stop as a flat colour", () => {
    expect(gradientCss([{ offset: 0.3, color: "#ff0000" }])).toBe("linear-gradient(90deg, #ff0000 30%, #ff0000 30%)");
  });
});
