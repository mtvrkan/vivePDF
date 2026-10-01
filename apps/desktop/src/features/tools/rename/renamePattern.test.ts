import { describe, expect, it } from "vitest";
import { renamedPaths, unknownTokens } from "./renamePattern";

const KNOWN = ["name", "title", "date", "year", "invoice", "amount", "author", "pages"];

describe("unknownTokens", () => {
  it("is quiet when every field is one the tool knows", () => {
    expect(unknownTokens("{title}-{date}", KNOWN)).toEqual([]);
  });

  it("names a field that does not exist", () => {
    expect(unknownTokens("{n}", KNOWN)).toEqual(["n"]);
  });

  it("names each unknown field once", () => {
    expect(unknownTokens("{n}-{n}-{number}", KNOWN)).toEqual(["n", "number"]);
  });

  it("ignores the spaces around a field name", () => {
    expect(unknownTokens("{ title }", KNOWN)).toEqual([]);
  });

  it("leaves plain text alone", () => {
    expect(unknownTokens("fatura-2026", KNOWN)).toEqual([]);
    expect(unknownTokens("", KNOWN)).toEqual([]);
  });

  it("does not trip over an empty pair of braces", () => {
    expect(unknownTokens("{}", KNOWN)).toEqual([]);
  });
});

describe("renamedPaths", () => {
  it("follows each renamed file to its new path and keeps the rest", () => {
    const results = [
      { path: "C:/a.pdf", output: "C:/Invoice 1.pdf", ok: true },
      { path: "C:/b.pdf", output: null, ok: false },
    ];
    expect(renamedPaths(["C:/a.pdf", "C:/b.pdf", "C:/c.pdf"], results)).toEqual(["C:/Invoice 1.pdf", "C:/b.pdf", "C:/c.pdf"]);
  });
});
