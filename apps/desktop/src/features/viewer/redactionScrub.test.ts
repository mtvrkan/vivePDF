import { beforeEach, describe, expect, it, vi } from "vitest";

const redactedText = vi.fn();
const scrubHidden = vi.fn();

vi.mock("@/shared/rpc/operations", () => ({
  redactedText: (...args: unknown[]) => redactedText(...args),
  scrubHidden: (...args: unknown[]) => scrubHidden(...args),
}));

const { planRedactionScrub, redactionAreas, scrubRedactedFile } = await import("./redactionScrub");

const rect = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

const pending = {
  0: [{ id: "a", page: 0, rect: rect(10, 20, 100, 12), source: "annotation", markColor: "#f00", redactionColor: "#000", kind: "area" }],
  2: [{ id: "b", page: 2, rect: rect(0, 0, 300, 40), source: "legacy", markColor: "#f00", redactionColor: "#000", kind: "text", rects: [rect(5, 6, 50, 10), rect(5, 20, 70, 10)], text: " Ayşe Yıldırım " }],
} as unknown as Parameters<typeof redactionAreas>[0];

describe("redaction scrub", () => {
  beforeEach(() => {
    redactedText.mockReset();
    scrubHidden.mockReset();
  });

  it("turns pending redactions into one-based page areas and keeps selected text", () => {
    const plan = redactionAreas(pending);
    expect(plan.areas).toEqual([
      { page: 1, x0: 10, y0: 20, x1: 110, y1: 32 },
      { page: 3, x0: 5, y0: 6, x1: 55, y1: 16 },
      { page: 3, x0: 5, y0: 20, x1: 75, y1: 30 },
    ]);
    expect(plan.texts).toEqual(["Ayşe Yıldırım"]);
  });

  it("adds the words the engine reads under the areas, once each", async () => {
    redactedText.mockResolvedValue({ texts: ["Ayşe Yıldırım", "Kaya"] });
    const plan = await planRedactionScrub("a.pdf", "pw", pending);
    expect(redactedText).toHaveBeenCalledWith({ path: "a.pdf", password: "pw", areas: expect.any(Array) });
    expect(plan?.texts).toEqual(["Ayşe Yıldırım", "Kaya"]);
  });

  it("still scrubs by area when reading the words fails, and skips work with nothing pending", async () => {
    redactedText.mockRejectedValue(new Error("busy"));
    const plan = await planRedactionScrub("a.pdf", undefined, pending);
    expect(plan?.areas).toHaveLength(3);
    expect(await planRedactionScrub("a.pdf", undefined, {})).toBeNull();
    expect(await scrubRedactedFile("a.pdf", undefined, null)).toBe(0);
    expect(scrubHidden).not.toHaveBeenCalled();
  });

  it("reports how many hidden copies were removed", async () => {
    scrubHidden.mockResolvedValue({ output: "a.pdf", pageCount: 1, bytes: 1, hidden: 4 });
    expect(await scrubRedactedFile("a.pdf", "pw", { areas: [], texts: ["x"] })).toBe(4);
    expect(scrubHidden).toHaveBeenCalledWith({ path: "a.pdf", password: "pw", texts: ["x"], areas: [] });
  });
});
