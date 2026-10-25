import { describe, expect, it } from "vitest";
import { looksTitleCase, sentenceCase, titleLocale } from "./sentenceCase";

describe("sentenceCase", () => {
  it("lowercases title-cased words but keeps the first word and the word after a colon", () => {
    const title = "Deep Residual Learning for Image Recognition: A New Approach to Long-Term Memory";

    const converted = sentenceCase(title, "en");

    expect(converted).toBe("Deep residual learning for image recognition: A new approach to long-term memory");
  });

  it("keeps acronyms, inner capitals, digits and brace-protected words", () => {
    const title = "Using the iPhone to Track COVID-19 and CO2 in {Turkey} with NASA Data. Results From Ankara";

    const converted = sentenceCase(title, "en");

    expect(converted).toBe("Using the iPhone to track COVID-19 and CO2 in {Turkey} with NASA data. Results from ankara");
  });

  it("lowercases Turkish letters with the Turkish rules", () => {
    const title = "Sosyal Bilgilerde Kavram Öğretiminde Web 2.0 Araçları: İlkokul Öğretmenlerinin Görüşleri";

    const converted = sentenceCase(title, titleLocale(undefined, "tr-TR"));

    expect(converted).toBe("Sosyal bilgilerde kavram öğretiminde web 2.0 araçları: İlkokul öğretmenlerinin görüşleri");
  });

  it("returns an empty title unchanged", () => {
    expect(sentenceCase("", "en")).toBe("");
    expect(sentenceCase("   ", "en")).toBe("   ");
  });
});

describe("looksTitleCase", () => {
  it("spots Title Case and leaves sentence case alone", () => {
    expect(looksTitleCase("Why Most Published Research Findings Are False", "en")).toBe(true);
    expect(looksTitleCase("Why most published research findings are false", "en")).toBe(false);
    expect(looksTitleCase("Deep learning in Turkey", "en")).toBe(false);
  });

  it("does not count acronyms or a single capitalised word", () => {
    expect(looksTitleCase("NASA and ESA data from the ISS", "en")).toBe(false);
    expect(looksTitleCase("", "en")).toBe(false);
  });

  it("picks the Turkish locale from the entry language before the document language", () => {
    expect(titleLocale("Turkish", "en-US")).toBe("tr");
    expect(titleLocale("en", "tr-TR")).toBe("en");
    expect(titleLocale(undefined, "tr-TR")).toBe("tr");
  });
});
