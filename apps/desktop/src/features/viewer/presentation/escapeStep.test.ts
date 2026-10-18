import { describe, expect, it } from "vitest";
import { escapeStep, type EscapeContext } from "./escapeStep";

const idle: EscapeContext = { codeBlockOpen: null, overviewOpen: false, tool: "pointer", blackout: "none" };

describe("escapeStep", () => {
  it("takes one step back at a time, innermost first", () => {
    expect(escapeStep({ ...idle, codeBlockOpen: { pageIndex: 0, blockId: "a" }, overviewOpen: true, tool: "pen", blackout: "black" })).toBe("closeCodeBlock");
    expect(escapeStep({ ...idle, overviewOpen: true, tool: "pen", blackout: "black" })).toBe("closeOverview");
    expect(escapeStep({ ...idle, tool: "pen", blackout: "black" })).toBe("pointer");
    expect(escapeStep({ ...idle, blackout: "white" })).toBe("leaveBoard");
  });

  it("leaves the presentation only when nothing else is open", () => {
    expect(escapeStep(idle)).toBe("exit");
  });

  it("returns to the pointer before leaving a board drawn on", () => {
    expect(escapeStep({ ...idle, tool: "highlighter", blackout: "black" })).toBe("pointer");
    expect(escapeStep({ ...idle, blackout: "black" })).toBe("leaveBoard");
  });
});
