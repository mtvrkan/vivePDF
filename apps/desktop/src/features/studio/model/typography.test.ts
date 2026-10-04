import { describe, expect, it } from "vitest";
import { caseText, caseTexts, fitParagraphs, listMarkers, markerText, paragraphCount, splitParagraphs, visibleParagraphs, weightOf } from "./typography";

describe("studio typography", () => {
  it("changes case with Turkish dotted and dotless i", () => {
    expect(caseText("istanbul ılık", "upper", "tr")).toBe("İSTANBUL ILIK");
    expect(caseText("IŞIK İzmir", "lower", "tr-TR")).toBe("ışık izmir");
    expect(caseText("istanbul", "upper", "en")).toBe("ISTANBUL");
    expect(caseText("Kept As Is", "none", "en")).toBe("Kept As Is");
  });

  it("title-cases each word across run borders without touching apostrophes", () => {
    expect(caseTexts(["hello wo", "rld it's 2nd"], "title", "en")).toEqual(["Hello Wo", "rld It's 2nd"]);
    expect(caseText("izmir'e gidiyoruz", "title", "tr")).toBe("İzmir'e Gidiyoruz");
    expect(caseText("", "title", "en")).toBe("");
  });

  it("numbers list paragraphs per level and restarts after a plain paragraph", () => {
    const markers = listMarkers([
      { list: "decimal", level: 0 },
      { list: "alpha", level: 1 },
      { list: "alpha", level: 1 },
      { list: "decimal", level: 0 },
      { list: "roman", level: 1 },
      { list: "none", level: 0 },
      { list: "decimal", level: 0 },
      { list: "bullet", level: 0 },
    ]);

    expect(markers).toEqual(["1.", "a)", "b)", "2.", "i.", null, "1.", "•"]);
  });

  it("writes long letter and roman counters", () => {
    expect(markerText("alpha", 27)).toBe("aa)");
    expect(markerText("roman", 1994)).toBe("mcmxciv.");
    expect(markerText("check", 3)).toBe("✓");
    expect(markerText("none", 1)).toBeNull();
  });

  it("splits runs into paragraphs keeping each run's style", () => {
    const parts = splitParagraphs([{ text: "One\nTw" }, { text: "o", bold: true }], [{ list: "bullet", level: 0 }, { list: "bullet", level: 1 }]);

    expect(parts.map((part) => part.text)).toEqual(["One", "Two"]);
    expect(parts[1].runs).toEqual([{ text: "Tw" }, { text: "o", bold: true }]);
    expect(parts.map((part) => part.marker)).toEqual(["•", "•"]);
  });

  it("splits filled placeholder lines into paragraphs of the same list", () => {
    const parts = splitParagraphs([{ text: "{Items}" }], [{ list: "decimal", level: 0 }], () => "a\r\nb");

    expect(parts.map((part) => [part.text, part.marker])).toEqual([
      ["a", "1."],
      ["b", "2."],
    ]);
  });

  it("drops only a trailing empty paragraph and fits stored paragraphs to the text", () => {
    expect(visibleParagraphs(splitParagraphs([{ text: "a\n" }], [])).map((part) => part.text)).toEqual(["a"]);
    expect(visibleParagraphs(splitParagraphs([{ text: "" }], [])).map((part) => part.text)).toEqual([""]);
    expect(paragraphCount([{ text: "a\nb" }, { text: "\n" }])).toBe(3);
    expect(fitParagraphs([{ list: "dash", level: 2 }], 2)).toEqual([
      { list: "dash", level: 2 },
      { list: "none", level: 0 },
    ]);
  });

  it("resolves the effective weight from bold or an explicit weight", () => {
    expect(weightOf(false, null)).toBe(400);
    expect(weightOf(true, undefined)).toBe(700);
    expect(weightOf(true, 300)).toBe(300);
  });
});
