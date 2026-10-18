import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../i18n";
import { headingId } from "./headings";
import { DOCS } from "./structure";

const contentDir = new URL("../content/docs/", import.meta.url);

function frontmatterKey(file: URL): string | undefined {
  return /^key:\s*(\S+)/m.exec(readFileSync(file, "utf8"))?.[1];
}

describe("docs structure", () => {
  it("gives every page a unique slug in each language", () => {
    for (const locale of LOCALES) {
      const slugs = DOCS.map((d) => d.slug[locale]);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("has a Turkish and an English file for every page, named after its slug and keyed to it", () => {
    for (const locale of LOCALES) {
      const files = readdirSync(new URL(`${locale}/`, contentDir)).filter((f) => f.endsWith(".mdx"));
      const expected = DOCS.map((d) => `${d.slug[locale]}.mdx`).sort();
      expect(files.sort()).toEqual(expected);
      for (const doc of DOCS) expect(frontmatterKey(new URL(`${locale}/${doc.slug[locale]}.mdx`, contentDir))).toBe(doc.key);
    }
  });
});

describe("headingId", () => {
  it("keeps Turkish letters and joins words with dashes", () => {
    expect(headingId("Sık Sorulan Sorular?", "tr")).toBe("sık-sorulan-sorular");
  });

  it("lowercases the Turkish capital I as dotless", () => {
    expect(headingId("IŞIK", "tr")).toBe("ışık");
  });

  it("returns an empty id for punctuation only", () => {
    expect(headingId("?!", "en")).toBe("");
  });
});
