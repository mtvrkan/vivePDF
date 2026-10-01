import { describe, expect, it } from "vitest";
import { estimateSectionHeight, normalizePageText, overlapsRange, pageSentences, placeholderHeight, readingParagraphs } from "./readingLayout";

const PAGE = "Birinci cümle burada. İkinci cümle\nsatır sonunda devam eder.\n\nBaşlıksız paragraf\n\nÜçüncü cümle! Son mu?";

describe("readingParagraphs", () => {
  it("starts each bullet on its own line instead of running the list into the heading", () => {
    const paragraphs = readingParagraphs("Hedefler\n• Bu bölümde,\n• İşletim sistemi nedir?\n• Görevleri nelerdir?");
    expect(paragraphs.map((paragraph) => paragraph.pieces.map((piece) => piece.text).join(""))).toEqual(["Hedefler\n• Bu bölümde,\n• İşletim sistemi nedir?\n• Görevleri nelerdir?"]);
  });

  it("keeps every character and the paragraph layout", () => {
    const paragraphs = readingParagraphs(PAGE);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((paragraph) => paragraph.pieces.map((piece) => piece.text).join(""))).toEqual([
      "Birinci cümle burada. İkinci cümle satır sonunda devam eder.",
      "Başlıksız paragraf",
      "Üçüncü cümle! Son mu?",
    ]);
  });

  it("gives each piece its offsets in the whitespace-normalised page text the speaker uses", () => {
    const normalized = normalizePageText(PAGE);
    for (const paragraph of readingParagraphs(PAGE)) {
      for (const piece of paragraph.pieces) {
        expect(normalized.slice(piece.start, piece.end)).toBe(piece.text.replace(/\s+/g, " ").trim());
      }
    }
  });

  it("numbers pieces by the whole-page sentence list, so a sentence running over a paragraph break keeps one index", () => {
    const pieces = readingParagraphs(PAGE).flatMap((paragraph) => paragraph.pieces);
    const sentences = pageSentences(PAGE);
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "Birinci cümle burada.",
      "İkinci cümle satır sonunda devam eder.",
      "Başlıksız paragraf Üçüncü cümle!",
      "Son mu?",
    ]);
    const heading = pieces.find((piece) => piece.text === "Başlıksız paragraf");
    const third = pieces.find((piece) => piece.text.startsWith("Üçüncü"));
    expect(heading?.sentenceIndex).toBe(2);
    expect(third?.sentenceIndex).toBe(2);
    expect(pieces.at(-1)?.sentenceIndex).toBe(3);
  });

  it("highlights by the spoken range even when the speaker split differently", () => {
    const normalized = normalizePageText(PAGE);
    const spokenStart = normalized.indexOf("İkinci");
    const spokenEnd = normalized.indexOf("eder.") + "eder.".length;
    const hit = readingParagraphs(PAGE)
      .flatMap((paragraph) => paragraph.pieces)
      .filter((piece) => overlapsRange(piece, { start: spokenStart, end: spokenEnd }))
      .map((piece) => piece.text.trim());
    expect(hit).toEqual(["İkinci cümle satır sonunda devam eder."]);
  });

  it("returns nothing for an empty page", () => {
    expect(readingParagraphs("")).toEqual([]);
  });
});

describe("placeholderHeight", () => {
  it("uses the measured height for the same layout", () => {
    expect(placeholderHeight({ layoutKey: "18|medium", height: 812 }, "18|medium", "x", 18)).toBe(812);
  });

  it("falls back to the estimate when font size or width changed", () => {
    expect(placeholderHeight({ layoutKey: "18|medium", height: 812 }, "20|medium", "x", 20)).toBe(estimateSectionHeight("x", 20));
    expect(placeholderHeight(null, "18|medium", "x", 18)).toBe(estimateSectionHeight("x", 18));
  });
});
