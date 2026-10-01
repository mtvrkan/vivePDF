import { describe, expect, it, vi } from "vitest";
import { accessibleParagraphs, createPageTextLoader } from "./pageTextLoader";

describe("createPageTextLoader", () => {
  it("fetches the pages asked for together in one call and caches them", async () => {
    vi.useFakeTimers();
    const fetchTexts = vi.fn(async (pages: number[]) => pages.map((page) => ({ page, text: `metin ${page}` })));
    const loader = createPageTextLoader(fetchTexts, 50);
    const requests = [loader.request(4), loader.request(2), loader.request(4)];
    await vi.advanceTimersByTimeAsync(50);
    expect(await Promise.all(requests)).toEqual(["metin 4", "metin 2", "metin 4"]);
    expect(fetchTexts).toHaveBeenCalledTimes(1);
    expect(fetchTexts).toHaveBeenCalledWith([2, 4]);
    expect(loader.cached(2)).toBe("metin 2");
    expect(await loader.request(2)).toBe("metin 2");
    expect(fetchTexts).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("forgets the oldest pages past the limit and treats missing pages as empty", async () => {
    vi.useFakeTimers();
    const loader = createPageTextLoader(async () => [{ page: 1, text: "bir" }], 10, 1);
    const both = Promise.all([loader.request(1), loader.request(2)]);
    await vi.advanceTimersByTimeAsync(10);
    expect(await both).toEqual(["bir", ""]);
    expect(loader.cached(1)).toBeUndefined();
    expect(loader.cached(2)).toBe("");
    vi.useRealTimers();
  });

  it("rejects waiting pages when the fetch fails and retries on the next request", async () => {
    vi.useFakeTimers();
    const fetchTexts = vi.fn().mockRejectedValueOnce(new Error("kilitli")).mockResolvedValueOnce([{ page: 3, text: "üç" }]);
    const loader = createPageTextLoader(fetchTexts, 10);
    const failed = loader.request(3);
    const failure = expect(failed).rejects.toThrow("kilitli");
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    const retried = loader.request(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(await retried).toBe("üç");
    vi.useRealTimers();
  });
});

describe("accessibleParagraphs", () => {
  it("joins wrapped lines and keeps sentence ends as paragraph breaks", () => {
    expect(accessibleParagraphs("Başlık:\nBirinci satır\ndevamı.\r\n\nİkinci   paragraf\n  \n")).toEqual(["Başlık:", "Birinci satır devamı.", "İkinci paragraf"]);
  });

  it("keeps a bullet line apart from the line before it", () => {
    expect(accessibleParagraphs("Hedefler\n• Birinci madde\n• İkinci madde")).toEqual(["Hedefler", "• Birinci madde", "• İkinci madde"]);
  });

  it("gives nothing for a page without text", () => {
    expect(accessibleParagraphs(" \n ")).toEqual([]);
  });
});
