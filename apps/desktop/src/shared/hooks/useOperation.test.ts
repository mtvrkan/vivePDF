import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@/shared/lib/reveal", () => ({ revealPath: vi.fn() }));

import { resultOutlivedSource } from "./useOperation";
import { useSourceChangeStore } from "@/shared/store/sourceChangeStore";

describe("resultOutlivedSource", () => {
  it("clears the result once the source document changed", () => {
    expect(resultOutlivedSource(3, 4, false)).toBe(true);
  });

  it("keeps the result while the source stays the same", () => {
    expect(resultOutlivedSource(4, 4, false)).toBe(false);
  });

  it("does not interrupt a run that is still going", () => {
    expect(resultOutlivedSource(3, 4, true)).toBe(false);
  });
});

describe("useSourceChangeStore", () => {
  it("moves the epoch forward on every source change", () => {
    const before = useSourceChangeStore.getState().epoch;
    useSourceChangeStore.getState().changed();
    useSourceChangeStore.getState().changed();
    expect(useSourceChangeStore.getState().epoch).toBe(before + 2);
  });
});
