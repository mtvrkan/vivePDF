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

  it("leaves Escape to a dialog opened over the presentation, even over a code block", () => {
    expect(escapeStep({ ...idle, tool: "pen", blackout: "black", openDialogs: 1 })).toBe("dialog");
    expect(escapeStep({ ...idle, codeBlockOpen: { pageIndex: 0, blockId: "a" }, openDialogs: 2 })).toBe("dialog");
  });

  it("counts the open code block as its own dialog", () => {
    expect(escapeStep({ ...idle, codeBlockOpen: { pageIndex: 0, blockId: "a" }, openDialogs: 1 })).toBe("closeCodeBlock");
    expect(escapeStep({ ...idle, openDialogs: 0 })).toBe("exit");
  });

  it("returns to the pointer before leaving a board drawn on", () => {
    expect(escapeStep({ ...idle, tool: "highlighter", blackout: "black" })).toBe("pointer");
    expect(escapeStep({ ...idle, blackout: "black" })).toBe("leaveBoard");
  });
});
