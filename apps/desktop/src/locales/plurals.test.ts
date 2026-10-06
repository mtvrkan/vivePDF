import { describe, expect, it } from "vitest";
import ar from "./ar/common.json";
import de from "./de/common.json";
import en from "./en/common.json";
import es from "./es/common.json";
import fr from "./fr/common.json";
import it_ from "./it/common.json";
import ptBR from "./pt-BR/common.json";
import tr from "./tr/common.json";

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = { ar, de, en, es, fr, it: it_, "pt-BR": ptBR, tr };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const REQUIRED_CATEGORIES: Record<string, string[]> = {
  ar: ["zero", "one", "two", "few", "many", "other"],
};

function flatten(node: Catalog, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value as Catalog, path, out);
    else if (typeof value === "string") out[path] = value;
  }
  return out;
}

const english = flatten(en as Catalog);
const pluralBases = [...new Set(Object.keys(english).filter((key) => key.endsWith("_other")).map((key) => key.replace(PLURAL_SUFFIX, "")))];

describe("plural forms", () => {
  it("never writes counted English nouns as a single string", () => {
    const counted = Object.entries(english).filter(([key, value]) => value.includes("{{count}}") && !PLURAL_SUFFIX.test(key) && /\(s\)|\{\{count\}\} (\w+ )?(pages|files|documents|fields|images|fonts|links)\b/.test(value));
    expect(counted).toEqual([]);
  });

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has every plural category its language needs`, () => {
      const flat = flatten(catalog);
      const categories = REQUIRED_CATEGORIES[locale] ?? ["one", "other"];
      const missing: string[] = [];
      for (const base of pluralBases) {
        for (const category of categories) {
          if (!(`${base}_${category}` in flat)) missing.push(`${base}_${category}`);
        }
      }
      expect(missing).toEqual([]);
    });
  }
});

describe("plural resolution at runtime", () => {
  it("picks the right form from the base key the code uses", async () => {
    (globalThis as unknown as { localStorage: { getItem: () => null; setItem: () => void; removeItem: () => void } }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    (globalThis as unknown as { document: { documentElement: { lang: string; dir: string } } }).document = {
      documentElement: { lang: "", dir: "" },
    };
    const { default: i18n, ready, setLocale } = await import("@/app/i18n");
    await ready();
    await setLocale("en");
    expect(i18n.t("tools.batch.summary", { count: 1 })).toBe("1 document processed.");
    expect(i18n.t("tools.batch.summary", { count: 4 })).toBe("4 documents processed.");
    await setLocale("ar");
    expect(i18n.t("tools.batch.summary", { count: 2 })).not.toBe(i18n.t("tools.batch.summary", { count: 5 }));
    await setLocale("en");
  });
});
