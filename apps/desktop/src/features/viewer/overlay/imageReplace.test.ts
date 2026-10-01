import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ imagePreview: vi.fn() }));

import { placedAspect } from "./imageReplace";

describe("placedAspect", () => {
  it("keeps the picture aspect for an upright placement", () => {
    expect(placedAspect(600, 450, 0)).toBeCloseTo(4 / 3);
    expect(placedAspect(600, 450, 180)).toBeCloseTo(4 / 3);
  });

  it("swaps the aspect when the original placement is turned a quarter", () => {
    expect(placedAspect(600, 450, 90)).toBeCloseTo(3 / 4);
    expect(placedAspect(600, 450, 270)).toBeCloseTo(3 / 4);
  });
});
