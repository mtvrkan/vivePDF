import { describe, expect, it } from "vitest";
import type { TranslateModel } from "@/types";
import { languageCodeFor, languageName, languagePacks, localeOfLanguage, packsForMissing, pairLanguages, partnerLanguage } from "./translateLanguage";

function model(id: string, installed: boolean, sizeMb = 100, origin: TranslateModel["origin"] = "catalog"): TranslateModel {
  const [source, target] = pairLanguages(id);
  return { id, source, target, version: "1.9", sizeMb, installed, origin };
}

describe("translateLanguage", () => {
  it("maps app locales to Argos language codes", () => {
    expect(languageCodeFor("tr")).toBe("tr");
    expect(languageCodeFor("pt-BR")).toBe("pb");
    expect(languageCodeFor("zh-CN")).toBe("zh");
  });

  it("maps Argos quirk codes back to display locales", () => {
    expect(localeOfLanguage("pb")).toBe("pt-BR");
    expect(localeOfLanguage("zh")).toBe("zh-CN");
    expect(localeOfLanguage("zt")).toBe("zh-Hant");
    expect(localeOfLanguage("de")).toBe("de");
  });

  it("names languages in the interface language and falls back to the code", () => {
    expect(languageName("de", "en")).toBe("German");
    expect(languageName("pb", "en")).toBe("Brazilian Portuguese");
    expect(languageName("de", "not a locale!")).toBe("de");
  });

  it("splits a model id into its two languages", () => {
    expect(pairLanguages("en_tr")).toEqual(["en", "tr"]);
    expect(pairLanguages("broken")).toEqual(["broken", ""]);
  });

  it("groups both English directions of a language into one pack with its install state", () => {
    const packs = languagePacks([model("en_de", false, 90), model("de_en", true, 92), model("en_tr", true), model("tr_en", true), model("en_fr", false, 80), model("fr_en", false, 81)]);
    const byCode = Object.fromEntries(packs.map((pack) => [pack.code, pack]));
    expect(byCode.de).toMatchObject({ state: "partial", missing: ["en_de"], sizeMb: 182, missingSizeMb: 90 });
    expect(byCode.de.pairs.map((pair) => pair.id)).toEqual(["de_en", "en_de"]);
    expect(byCode.tr).toMatchObject({ state: "full", missing: [], missingSizeMb: 0 });
    expect(byCode.fr).toMatchObject({ state: "none", missing: ["fr_en", "en_fr"], sizeMb: 161 });
  });

  it("leaves imported pairs and direct pairs without English out of the packs", () => {
    expect(languagePacks([model("en_nl", true, 88, "custom"), model("pt_es", false)])).toEqual([]);
    expect(languagePacks([])).toEqual([]);
  });

  it("turns missing pair ids into the languages to download", () => {
    expect(packsForMissing(["de_en", "en_tr"])).toEqual(["de", "tr"]);
    expect(packsForMissing(["en_tr", "tr_en"])).toEqual(["tr"]);
    expect(packsForMissing(["pt_es"])).toEqual(["pt", "es"]);
    expect(packsForMissing([])).toEqual([]);
    expect(partnerLanguage("tr_en")).toBe("tr");
  });
});
