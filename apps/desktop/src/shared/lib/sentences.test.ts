import { describe, expect, it } from "vitest";
import { locateSentences, splitSentences } from "./sentences";
import fixture from "./sentences.fixture.json";

describe("sentences", () => {
  it("splits plain sentences on terminal punctuation", () => {
    expect(splitSentences("Merhaba dünya. Nasılsın?")).toEqual(["Merhaba dünya.", "Nasılsın?"]);
  });

  it("guards common abbreviations from splitting", () => {
    expect(splitSentences("Dr. Smith went home. He was tired!")).toEqual([
      "Dr. Smith went home.",
      "He was tired!",
    ]);
  });

  it("caps long sentences at the character limit without losing text", () => {
    const long = `${"kelime ".repeat(20).trim()}.`;
    const result = splitSentences(long, 30);
    expect(result.every((chunk) => chunk.length <= 30)).toBe(true);
    expect(result.join(" ").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
  });

  it("returns an empty list for blank input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });

  it("locates sentence offsets within the normalized text", () => {
    const text = "Merhaba dünya. Nasılsın?";
    const located = locateSentences(text, splitSentences(text));
    expect(located).toEqual([
      { text: "Merhaba dünya.", start: 0, end: 14 },
      { text: "Nasılsın?", start: 15, end: 24 },
    ]);
  });
});

describe("shared sentence fixture", () => {
  it("splits every fixture case exactly like the sidecar split_sentences", () => {
    for (const entry of fixture.cases) {
      expect(splitSentences(entry.text, fixture.maxChars)).toEqual(entry.sentences);
    }
  });
});
