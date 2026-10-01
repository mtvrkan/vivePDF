import { describe, expect, it } from "vitest";
import { fieldClass } from "./fieldClass";

describe("fieldClass", () => {
  it("lets a caller's width win over the base width", () => {
    expect(fieldClass("field h-row w-full px-3", "w-16")).toBe("field h-row px-3 w-16");
  });

  it("lets a caller's height win over the base height", () => {
    expect(fieldClass("h-row w-full", "h-8")).toBe("w-full h-8");
  });

  it("keeps everything that does not clash", () => {
    expect(fieldClass("field w-full", "font-mono")).toBe("field w-full font-mono");
  });

  it("ignores what is not there", () => {
    expect(fieldClass("w-full", undefined, false, null)).toBe("w-full");
  });

  it("takes the last of several clashing classes", () => {
    expect(fieldClass("text-base", "text-sm", "text-xs")).toBe("text-xs");
  });
});

describe("fieldClass and the project's own scale", () => {
  it("knows h-row is a height", () => {
    expect(fieldClass("h-row", "h-8")).toBe("h-8");
    expect(fieldClass("h-8", "h-row")).toBe("h-row");
  });

  it("knows text-display is a size", () => {
    expect(fieldClass("text-display", "text-sm")).toBe("text-sm");
  });
});
