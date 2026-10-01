import { describe, expect, it } from "vitest";
import glossary from "../../../../docs/glossary.json";
import ar from "./ar/common.json";
import de from "./de/common.json";
import en from "./en/common.json";
import es from "./es/common.json";
import fr from "./fr/common.json";
import it_ from "./it/common.json";
import ja from "./ja/common.json";
import ko from "./ko/common.json";
import ptBR from "./pt-BR/common.json";
import ru from "./ru/common.json";
import zhCN from "./zh-CN/common.json";

type Catalog = Record<string, unknown>;

interface GlossaryTerm {
  id: string;
  en: string;
  enPattern: string;
  check: boolean;
  translations: Record<string, string>;
  match?: Record<string, string[]>;
}

interface Glossary {
  locales: string[];
  ignoreKeyPattern: string;
  terms: GlossaryTerm[];
  exceptions: Record<string, Record<string, string[]>>;
}

const catalogs: Record<string, Catalog> = {
  ar,
  de,
  es,
  fr,
  it: it_,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  "zh-CN": zhCN,
};

const data = glossary as unknown as Glossary;

function flatten(node: Catalog, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value as Catalog, path, out);
    else if (typeof value === "string") out[path] = value;
  }
  return out;
}

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/\u0451/g, "\u0435");
}

function stripPlaceholders(text: string): string {
  return text.replace(/\{\{\s*\w+\s*\}\}/g, " ").replace(/\{\w+\}/g, " ");
}

function isExcepted(locale: string, key: string, termId: string): boolean {
  const shared = data.exceptions["*"]?.[key] ?? [];
  const local = data.exceptions[locale]?.[key] ?? [];
  return shared.includes(termId) || local.includes(termId);
}

function stemsFor(term: GlossaryTerm, locale: string): string[] {
  const stems = term.match?.[locale] ?? [term.translations[locale]];
  return stems.map(normalizeForMatch);
}

function findViolations(locale: string): string[] {
  const english = flatten(en as Catalog);
  const localized = flatten(catalogs[locale]);
  const ignore = new RegExp(data.ignoreKeyPattern);
  const problems: string[] = [];
  for (const term of data.terms) {
    if (!term.check) continue;
    const pattern = new RegExp(term.enPattern, "i");
    const stems = stemsFor(term, locale);
    for (const [key, source] of Object.entries(english)) {
      if (ignore.test(key)) continue;
      const target = localized[key];
      if (target === undefined) continue;
      if (!pattern.test(stripPlaceholders(source))) continue;
      if (isExcepted(locale, key, term.id)) continue;
      const haystack = normalizeForMatch(target);
      if (!stems.some((stem) => haystack.includes(stem))) {
        problems.push(`${term.id} · ${key} · "${target}" (expected ${term.translations[locale]})`);
      }
    }
  }
  return problems;
}

describe("glossary file", () => {
  it("covers every locale for every term", () => {
    for (const term of data.terms) {
      for (const locale of data.locales) {
        expect(term.translations[locale], `${term.id} ${locale}`).toBeTruthy();
      }
    }
  });

  it("has unique term ids and valid English patterns", () => {
    const ids = data.terms.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const term of data.terms) expect(() => new RegExp(term.enPattern, "i")).not.toThrow();
  });

  it("matches each preferred translation with its own stems", () => {
    for (const term of data.terms) {
      if (!term.check) continue;
      for (const locale of data.locales) {
        const preferred = normalizeForMatch(term.translations[locale]);
        expect(
          stemsFor(term, locale).some((stem) => preferred.includes(stem)),
          `${term.id} ${locale}`,
        ).toBe(true);
      }
    }
  });

  it("only lists exceptions for known terms and keys", () => {
    const english = flatten(en as Catalog);
    const ids = new Set(data.terms.map((term) => term.id));
    for (const rows of Object.values(data.exceptions)) {
      for (const [key, termIds] of Object.entries(rows)) {
        expect(english[key], key).toBeDefined();
        for (const termId of termIds) expect(ids.has(termId), termId).toBe(true);
      }
    }
  });
});

describe("file-name fragments", () => {
  const english = flatten(en as Catalog);
  const ignore = new RegExp(data.ignoreKeyPattern);
  const fragmentKeys = Object.keys(english).filter((key) => ignore.test(key));

  for (const locale of Object.keys(catalogs)) {
    it(`${locale} keeps file-name fragments ASCII and as distinct as English`, () => {
      const localized = flatten(catalogs[locale]);
      const problems: string[] = [];
      for (const key of fragmentKeys) {
        const value = localized[key] ?? "";
        if (!/^[!-~]+$/.test(value)) problems.push(`${key}: "${value}" is not a single ASCII token`);
        for (const other of fragmentKeys) {
          if (other <= key) continue;
          if (localized[other] === value && english[other] !== english[key]) problems.push(`${key} and ${other} share "${value}"`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("glossary terminology per locale", () => {
  for (const locale of Object.keys(catalogs)) {
    it(`${locale} uses the glossary term wherever English does`, () => {
      expect(findViolations(locale)).toEqual([]);
    });
  }
});
