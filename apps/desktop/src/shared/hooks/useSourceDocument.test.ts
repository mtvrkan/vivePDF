import { describe, expect, it } from "vitest";
import { shouldPrefillSource } from "./useSourceDocument";
import type { SourceDocument } from "@/types";

const open = { path: "C:/docs/open.pdf", fileName: "open.pdf", password: null, info: null };
const picked: SourceDocument = { path: "C:/docs/picked.pdf", fileName: "picked.pdf", password: null, info: null };

describe("shouldPrefillSource", () => {
  it("takes the open document when the page has none", () => {
    expect(shouldPrefillSource(false, null, open)).toBe(true);
  });

  it("leaves a file handed to the page alone, even before it has loaded", () => {
    expect(shouldPrefillSource(true, null, open)).toBe(false);
  });

  it("never replaces a source that is already there", () => {
    expect(shouldPrefillSource(false, picked, open)).toBe(false);
  });

  it("does nothing when no document is open", () => {
    expect(shouldPrefillSource(false, null, null)).toBe(false);
  });
});
