import { describe, expect, it } from "vitest";
import { liveActiveDocumentId } from "./useLiveActiveDocument";

describe("liveActiveDocumentId", () => {
  it("keeps a registered, loaded document active", () => {
    expect(liveActiveDocumentId("a", "loaded", true)).toBe("a");
  });

  it("keeps a copy that is still loading before it is registered", () => {
    expect(liveActiveDocumentId("copy", "loading", false)).toBe("copy");
  });

  it("drops a loaded document the app already closed, and an id without state", () => {
    expect(liveActiveDocumentId("closed", "loaded", false)).toBeNull();
    expect(liveActiveDocumentId("gone", null, true)).toBeNull();
    expect(liveActiveDocumentId(null, "loaded", true)).toBeNull();
  });
});
