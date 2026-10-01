import { describe, expect, it } from "vitest";
import { defineUrl, scholarUrl, searchUrl, translateUrl, wikipediaUrl } from "./webSearch";

describe("searchUrl", () => {
  it("builds a query url for the configured engine", () => {
    expect(searchUrl("google", "pdf editor")).toBe("https://www.google.com/search?q=pdf%20editor");
    expect(searchUrl("duckduckgo", "pdf editor")).toBe("https://duckduckgo.com/?q=pdf%20editor");
  });

  it("substitutes the custom template placeholder", () => {
    expect(searchUrl("custom", "foo", "https://example.com/s?q={{q}}")).toBe("https://example.com/s?q=foo");
  });

  it("accepts the single brace placeholder the settings hint shows", () => {
    expect(searchUrl("custom", "işlem yönetimi", " https://example.com/s?q={q}&lang=tr ")).toBe("https://example.com/s?q=i%C5%9Flem%20y%C3%B6netimi&lang=tr");
  });

  it("appends the query to a custom address without a placeholder", () => {
    expect(searchUrl("custom", "foo", "https://example.com/s?q=")).toBe("https://example.com/s?q=foo");
  });

  it("falls back to Google when the custom address is empty or not a web address", () => {
    expect(searchUrl("custom", "foo", "")).toBe("https://www.google.com/search?q=foo");
    expect(searchUrl("custom", "foo", "javascript:alert({q})")).toBe("https://www.google.com/search?q=foo");
    expect(searchUrl("custom", "foo", "example.com/{q}")).toBe("https://www.google.com/search?q=foo");
  });

  it("trims queries longer than 500 characters before encoding", () => {
    const long = "a".repeat(600);
    const url = searchUrl("google", long);
    expect(url).toBe(`https://www.google.com/search?q=${"a".repeat(500)}`);
  });
});

describe("defineUrl", () => {
  it("uses TDK Sozluk for the tr locale", () => {
    expect(defineUrl("kitap", "tr")).toBe("https://sozluk.gov.tr/?ara=kitap");
  });

  it("uses English Wiktionary for the en locale", () => {
    expect(defineUrl("book", "en")).toBe("https://en.wiktionary.org/wiki/book");
  });

  it("falls back to English Wiktionary for an unknown locale", () => {
    expect(defineUrl("book", "xx")).toBe("https://en.wiktionary.org/wiki/book");
  });
});

describe("scholarUrl", () => {
  it("builds a Google Scholar search url", () => {
    expect(scholarUrl("neural networks")).toBe("https://scholar.google.com/scholar?q=neural%20networks");
  });
});

describe("wikipediaUrl", () => {
  it("uses the locale subdomain", () => {
    expect(wikipediaUrl("pdf", "tr")).toBe("https://tr.wikipedia.org/w/index.php?search=pdf");
  });
});

describe("translateUrl", () => {
  it("translates into the interface language", () => {
    expect(translateUrl("hello", "tr")).toBe("https://translate.google.com/?sl=auto&tl=tr&text=hello&op=translate");
    expect(translateUrl("merhaba", "en")).toContain("tl=en");
    expect(translateUrl("merhaba", "de")).toContain("tl=de");
    expect(translateUrl("merhaba", "zh-CN")).toContain("tl=zh-CN");
    expect(translateUrl("merhaba", "pt-BR")).toContain("tl=pt&");
  });

  it("keeps a whole paragraph instead of cutting it at 500 characters", () => {
    const paragraph = "word ".repeat(150).trim();
    expect(decodeURIComponent(new URL(translateUrl(paragraph, "en")).searchParams.get("text") ?? "")).toBe(paragraph);
  });

  it("shortens very long text at a word boundary so the address stays openable", () => {
    const long = "çalışma ".repeat(400).trim();
    const url = translateUrl(long, "tr");
    const text = new URL(url).searchParams.get("text") ?? "";
    expect(encodeURIComponent(text).length).toBeLessThanOrEqual(1800);
    expect(text.endsWith("çalışma")).toBe(true);
    expect(long.startsWith(text)).toBe(true);
  });
});
