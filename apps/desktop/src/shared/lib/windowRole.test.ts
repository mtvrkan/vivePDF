import { afterEach, describe, expect, it, vi } from "vitest";

const label = vi.hoisted(() => ({ value: "main", fail: false }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (label.fail) throw new Error("no window");
    return { label: label.value };
  },
}));

afterEach(() => {
  vi.resetModules();
  label.value = "main";
  label.fail = false;
});

describe("windowRole", () => {
  it("knows an audience window by its label prefix", async () => {
    label.value = "present-0123456789abcdef0123456789abcdef";
    const { isAudienceWindow, isMainWindow } = await import("./windowRole");

    expect(isAudienceWindow()).toBe(true);
    expect(isMainWindow()).toBe(false);
  });

  it("treats the main and document windows as consoles, not audiences", async () => {
    const { isAudienceLabel } = await import("./windowRole");

    expect(isAudienceLabel("main")).toBe(false);
    expect(isAudienceLabel("doc-1")).toBe(false);
    expect(isAudienceLabel("xpresent-1")).toBe(false);
  });

  it("falls back to a plain window when the label cannot be read", async () => {
    label.fail = true;
    const { isAudienceWindow } = await import("./windowRole");

    expect(isAudienceWindow()).toBe(false);
  });
});
