import { describe, expect, it } from "vitest";
import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { keepsEditsOnLeave } from "./pending";

const image = { id: "i1", kind: "image", pageIndex: 0, x: 0, y: 0, width: 10, height: 10, dataUrl: "data:,", path: null, aspect: 1, opacity: 1 } as unknown as EditorPending;

describe("keepsEditsOnLeave", () => {
  it("keeps unsaved edits while their document is still open", () => {
    expect(keepsEditsOnLeave([image], true)).toBe(true);
  });

  it("drops the editor when nothing is pending", () => {
    expect(keepsEditsOnLeave([], true)).toBe(false);
  });

  it("drops edits whose document has been closed", () => {
    expect(keepsEditsOnLeave([image], false)).toBe(false);
  });
});
