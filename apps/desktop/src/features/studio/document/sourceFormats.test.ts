import { describe, expect, it } from "vitest";
import type { BibEntry } from "@/types/studio";
import { parseBibtex } from "./bibtex";
import { detectFormat, formatOfPath, parseSources, writeBibtex, writeSources } from "./sourceFormats";

const ARTICLE: BibEntry = {
  key: "yilmaz2020",
  type: "article",
  fields: { title: "Kentsel ısı & 100% {gölge} -- ölçüm_1", journal: "Kent Çalışmaları", year: "2020", month: "3", volume: "12", number: "3", pages: "45–67", doi: "10.1000/xyz_1", url: "https://example.org/a%20b?x=1&y=2" },
  authors: [
    { family: "Yılmaz", given: "Ayşe" },
    { family: "van der Berg", given: "Jan" },
    { family: "World Health Organization", given: "", literal: true },
    { family: "", given: "", others: true },
  ],
  editors: [],
};

const THESIS: BibEntry = { key: "dogan2019", type: "mastersthesis", fields: { title: "Gölgeli sokaklar", year: "2019", school: "ODTÜ", address: "Ankara" }, authors: [{ family: "Doğan", given: "Mehmet" }], editors: [] };

const ZOTERO_RIS = `TY  - JOUR
TI  - Urban heat
AU  - Lee, Min
AU  - Chen, Wei
T2  - Climate Journal
PY  - 2019/05/02/
VL  - 7
IS  - 2
SP  - 10
EP  - 22
DO  - 10.1/abc
KW  - heat
KW  - cities
ER  -

TY  - CHAP
TI  - Shade
AU  - Lee, Min
A2  - Park, Ji
T2  - Cities and climate
PB  - Springer
PY  - 2019
ER  -
`;

const CSL = JSON.stringify([
  { id: "smith2021", type: "book", title: "Green roofs", author: [{ family: "Smith", given: "Anna", "non-dropping-particle": "de" }], issued: { "date-parts": [[2021, 4]] }, publisher: "MIT Press", "publisher-place": "Cambridge", ISBN: "978-0" },
  { type: "thesis", genre: "Master's thesis", title: "Heat islands", author: [{ literal: "TÜBİTAK" }], issued: { raw: "2018" }, publisher: "Boğaziçi University" },
]);

describe("source formats", () => {
  it("writes BibTeX that reads back to the same sources", () => {
    const text = writeBibtex([ARTICLE, THESIS]);

    const parsed = parseBibtex(text);

    expect(parsed.skipped).toBe(0);
    expect(parsed.entries).toEqual([ARTICLE, THESIS]);
    expect(text).toContain("@article{yilmaz2020,\n  author = {Yılmaz, Ayşe and van der Berg, Jan and {World Health Organization} and others}");
  });

  it("reads a Zotero RIS export and gives each record a stable key", () => {
    const { entries } = parseSources(ZOTERO_RIS);

    expect(entries.map((entry) => [entry.key, entry.type])).toEqual([
      ["lee2019urban", "article"],
      ["lee2019shade", "incollection"],
    ]);
    expect(entries[0].fields).toMatchObject({ title: "Urban heat", journal: "Climate Journal", year: "2019", month: "5", volume: "7", number: "2", pages: "10–22", doi: "10.1/abc", keywords: "heat, cities" });
    expect(entries[0].authors).toEqual([
      { family: "Lee", given: "Min" },
      { family: "Chen", given: "Wei" },
    ]);
    expect(entries[1].editors).toEqual([{ family: "Park", given: "Ji" }]);
    expect(entries[1].fields).toMatchObject({ booktitle: "Cities and climate", publisher: "Springer" });
  });

  it("round-trips sources through RIS and CSL JSON without losing what the styles need", () => {
    for (const format of ["ris", "csl"] as const) {
      const { entries } = parseSources(writeSources([ARTICLE, THESIS], format), format);

      expect(entries.map((entry) => [entry.key, entry.type])).toEqual([
        ["yilmaz2020", "article"],
        ["dogan2019", "mastersthesis"],
      ]);
      expect(entries[0].fields).toMatchObject({ title: ARTICLE.fields.title, journal: "Kent Çalışmaları", year: "2020", month: "3", volume: "12", number: "3", pages: "45–67", doi: "10.1000/xyz_1" });
      expect(entries[0].authors.slice(0, 3)).toEqual(ARTICLE.authors.slice(0, 3));
      expect(entries[1].fields).toMatchObject({ school: "ODTÜ", address: "Ankara", year: "2019" });
    }
  });

  it("reads CSL JSON names, dates, particles and thesis kinds", () => {
    const { entries } = parseSources(CSL);

    expect(entries[0]).toMatchObject({ key: "smith2021", type: "book", fields: { year: "2021", month: "4", publisher: "MIT Press", address: "Cambridge", isbn: "978-0" } });
    expect(entries[0].authors).toEqual([{ family: "de Smith", given: "Anna" }]);
    expect(entries[1]).toMatchObject({ key: "tubitak2018heat", type: "mastersthesis", fields: { school: "Boğaziçi University", year: "2018" } });
    expect(entries[1].authors).toEqual([{ family: "TÜBİTAK", given: "", literal: true }]);
  });

  it("detects the format from the text or the file name and survives broken input", () => {
    expect(detectFormat("@book{a, title={x}}")).toBe("bibtex");
    expect(detectFormat("\uFEFF TY  - BOOK\nER  - ")).toBe("ris");
    expect(detectFormat(' [{"id":"a"}]')).toBe("csl");
    expect(formatOfPath("C:/refs/Library.JSON")).toBe("csl");
    expect(formatOfPath("/home/u/export.ris")).toBe("ris");
    expect(formatOfPath("refs.bibtex")).toBe("bibtex");
    expect(parseSources("[{broken", "csl")).toEqual({ entries: [], skipped: 1, duplicates: 0 });
    expect(parseSources("TY  - JOUR\nTI  - Same\nER  - \nTY  - JOUR\nTI  - Same\nER  - ").entries.map((entry) => entry.key)).toEqual(["same", "samea"]);
  });
});
