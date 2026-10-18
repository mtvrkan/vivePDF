import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INLINE_SCRIPTS, inlineScriptHashes } from "./inlineScripts";

describe("inline script hashes", () => {
  it("gives one sha256 source per inline script", () => {
    const hashes = inlineScriptHashes();

    expect(hashes).toHaveLength(Object.keys(INLINE_SCRIPTS).length);
    expect(new Set(hashes).size).toBe(hashes.length);
    hashes.forEach((h) => expect(h).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/));
  });

  it("hashes the exact script text the page carries", () => {
    const expected = createHash("sha256").update(INLINE_SCRIPTS.theme).digest("base64");

    expect(inlineScriptHashes()[0]).toBe(`sha256-${expected}`);
  });

  it("keeps the 404 swap limited to English addresses", () => {
    const swap = new Function("location", "document", "fetch", INLINE_SCRIPTS.notFoundSwap);
    const classes: string[] = [];
    const doc = { documentElement: { classList: { add: (c: string) => classes.push(c), remove: () => undefined } } };
    const fetchStub = () => new Promise(() => undefined);

    swap({ pathname: "/belge/" }, doc, fetchStub);
    expect(classes).toEqual([]);
    swap({ pathname: "/en/missing/" }, doc, fetchStub);
    expect(classes).toEqual(["nf-swap"]);
  });
});
