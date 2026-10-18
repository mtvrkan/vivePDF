import { describe, expect, it } from "vitest";
import { cardPng, cardSvg, wrapLines } from "./card";

const card = { lang: "tr", eyebrow: "Dokümantasyon · Gizlilik ve ayarlar", title: "Taranmış sayfaları aranabilir yapma (OCR)", description: "Beril'in taradığı sözleşmeyi aranabilir yapma & kopyalama <adım adım>.", address: "vivepdf.com/dokumantasyon/ocr" };

describe("og card", () => {
  it("renders a 1200×630 PNG", () => {
    const png = new Uint8Array(cardPng(card));

    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(1200);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(20)).toBe(630);
  });

  it("wraps long text and ends a cut line with an ellipsis", () => {
    expect(wrapLines("bir iki üç dört beş altı", 8, 2)).toEqual(["bir iki", "üç dört…"]);
    expect(wrapLines("tek", 8, 2)).toEqual(["tek"]);
  });

  it("escapes markup from titles and descriptions", () => {
    const svg = cardSvg(card);

    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;adım");
    expect(svg).not.toContain("<adım");
  });

  it("capitalises the eyebrow by the card's language", () => {
    expect(cardSvg(card)).toContain("DOKÜMANTASYON · GİZLİLİK VE AYARLAR");
  });
});
