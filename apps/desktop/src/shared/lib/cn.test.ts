import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("lets a caller's class win over a clashing base class", () => {
    expect(cn("inline-flex size-8 rounded-lg", "size-6")).toBe("inline-flex rounded-lg size-6");
    expect(cn("text-foreground/80", "text-destructive")).toBe("text-destructive");
  });

  it("knows the project's own spacing, text and easing scale", () => {
    expect(cn("h-topbar", "h-8")).toBe("h-8");
    expect(cn("w-inspector", "w-full")).toBe("w-full");
    expect(cn("text-display", "text-sm")).toBe("text-sm");
    expect(cn("text-display", "text-muted-foreground")).toBe("text-display text-muted-foreground");
  });

  it("keeps the project's own component classes and drops what is not there", () => {
    expect(cn("nav-glass glass-chip field card", false, null, undefined, "")).toBe("nav-glass glass-chip field card");
  });
});
