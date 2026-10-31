import { describe, expect, it } from "vitest";
import { hasStrokeWidth, isAnnotateTool, toolDefaults, worksOnText } from "./tools";

describe("drawing tools", () => {
  it("gives a pen its colour and width", () => {
    const defaults = toolDefaults("ink", "#1F6FEB", 8);

    expect(defaults).toEqual({ strokeColor: "#1F6FEB", color: "#1F6FEB", strokeWidth: 8 });
  });

  it("widens the marker and gives a note only its colour", () => {
    const shapes = [toolDefaults("inkHighlighter", "#FFCD45", 4), toolDefaults("textComment", "#2EA043", 8)];

    expect(shapes).toEqual([{ strokeColor: "#FFCD45", color: "#FFCD45", strokeWidth: 16 }, { strokeColor: "#2EA043", color: "#2EA043" }]);
  });

  it("rejects tools the viewer does not offer", () => {
    const checks = [isAnnotateTool("ink"), isAnnotateTool("stamp"), isAnnotateTool("link"), isAnnotateTool("freeText"), isAnnotateTool(3)];

    expect(checks).toEqual([true, false, false, false, false]);
  });

  it("knows which tools take a width and which work on text", () => {
    const flags = [hasStrokeWidth("square"), hasStrokeWidth("highlight"), worksOnText("underline"), worksOnText("ink")];

    expect(flags).toEqual([true, false, true, false]);
  });
});
