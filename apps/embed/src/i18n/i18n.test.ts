import { describe, expect, it } from "vitest";
import en from "./en.json";
import tr from "./tr.json";
import { createTranslator } from "./index";
import { resolveLang } from "./lang";

describe("resolveLang", () => {
  it("prefers the element attribute over the page language", () => {
    const lang = resolveLang("en", "tr-TR");

    expect(lang).toBe("en");
  });

  it("falls back to the page language and then to English", () => {
    const langs = [resolveLang(null, "tr-TR"), resolveLang("", "de"), resolveLang(null, "")];

    expect(langs).toEqual(["tr", "en", "en"]);
  });
});

describe("createTranslator", () => {
  it("fills placeholders and keeps unknown ones", () => {
    const t = createTranslator("tr");

    const texts = [t("pageOf", { total: 500 }), t("zoomLevel", {})];

    expect(texts).toEqual(["/ 500", "Yakınlaştırma: {value}"]);
  });

  it("has every key in both languages", () => {
    const keys = [Object.keys(tr).sort(), Object.keys(en).sort()];

    expect(keys[0]).toEqual(keys[1]);
  });
});
