import { describe, expect, it } from "vitest";
import { tokenizeLine } from "./highlight";

describe("tokenizeLine", () => {
  it("classifies keywords, strings, numbers and text for javascript", () => {
    const tokens = tokenizeLine('const x = "hi" + 42;', "javascript");
    expect(tokens).toContainEqual({ kind: "keyword", text: "const" });
    expect(tokens).toContainEqual({ kind: "string", text: '"hi"' });
    expect(tokens).toContainEqual({ kind: "number", text: "42" });
  });

  it("captures a trailing comment for hash-comment languages", () => {
    const tokens = tokenizeLine("x = 1  # note", "python");
    expect(tokens[tokens.length - 1]).toEqual({ kind: "comment", text: "# note" });
  });

  it("falls back to plain text tokens for an unknown language", () => {
    const tokens = tokenizeLine("foo bar", "made-up-language");
    expect(tokens.every((token) => token.kind === "text")).toBe(true);
  });
});
