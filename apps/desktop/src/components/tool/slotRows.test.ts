import { describe, expect, it } from "vitest";
import { MAX_SLOT_ROWS, slotRows } from "./slotRows";

describe("slotRows", () => {
  it("keeps an empty or single-line slot one row tall", () => {
    expect(slotRows("")).toBe(1);
    expect(slotRows("Page {n} of {total}")).toBe(1);
  });

  it("grows with each line of a multi-line header", () => {
    expect(slotRows("Acme Ltd\nConfidential")).toBe(2);
    expect(slotRows("a\r\nb\rc")).toBe(3);
  });

  it("stops growing at the row cap", () => {
    expect(slotRows("1\n2\n3\n4\n5\n6")).toBe(MAX_SLOT_ROWS);
  });
});
