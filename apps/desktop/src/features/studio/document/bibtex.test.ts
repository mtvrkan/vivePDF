import { describe, expect, it } from "vitest";
import { decodeLatex, mergeSources, normalizeSources, parseBibtex, parseNames } from "./bibtex";
import { writeBibtex } from "./sourceFormats";

const LIBRARY = String.raw`
% exported from Zotero
@string{ jnl = "Journal of " }
@comment{ jabref-meta: databaseType:bibtex; }
@Article{yilmaz2020,
  author  = {Y{\i}lmaz, Ay{\c{s}}e and Do{\u{g}}an, Mehmet and others},
  title   = {{\.I}stanbul'da {\"O}l{\c{c}}{\"u}m --- Yeni Bir Yakla{\c{s}}{\i}m},
  journal = jnl # "Urban Studies",
  year    = 2020,
  month   = mar,
  volume  = "12",
  pages   = {45--67},
  doi     = {10.1000/xyz\_123}
}
@book(knuth1984, author = "Donald E. Knuth", title = "The {\TeX}book", publisher = {Addison-Wesley}, year = {1984})
@misc{broken, title = {never closed
`;

describe("parseBibtex", () => {
  it("reads braced, quoted, numeric, macro and concatenated values with LaTeX accents", () => {
    const { entries } = parseBibtex(LIBRARY);

    const [article, book] = entries;
    expect(entries).toHaveLength(2);
    expect(article.key).toBe("yilmaz2020");
    expect(article.type).toBe("article");
    expect(article.fields.title).toBe("İstanbul'da Ölçüm — Yeni Bir Yaklaşım");
    expect(article.fields.journal).toBe("Journal of Urban Studies");
    expect(article.fields).toMatchObject({ year: "2020", month: "3", volume: "12", pages: "45–67", doi: "10.1000/xyz_123" });
    expect(article.authors).toEqual([{ family: "Yılmaz", given: "Ayşe" }, { family: "Doğan", given: "Mehmet" }, { family: "", given: "", others: true }]);
    expect(book.authors).toEqual([{ family: "Knuth", given: "Donald E." }]);
    expect(book.fields.title).toBe("The TeXbook");
  });

  it("counts a broken entry and a repeated key instead of failing the whole file", () => {
    const text = "@article{a, title={One}}\n@article{bad title={x}}\n@article{A, title={Again}}\n@book{b, title={Two}}";

    const result = parseBibtex(text);

    expect(result.entries.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(result.skipped).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it("finds nothing in text that holds no entries", () => {
    expect(parseBibtex("just some words @ here").entries).toEqual([]);
  });
});

describe("names and LaTeX", () => {
  it("splits names on a top-level and, keeps corporate authors and von particles", () => {
    const names = parseNames("{Barnes and Noble} and Ludwig van Beethoven and de la Cruz, Juana and J.-P. Sartre");

    expect(names).toEqual([
      { family: "Barnes and Noble", given: "", literal: true },
      { family: "van Beethoven", given: "Ludwig" },
      { family: "de la Cruz", given: "Juana" },
      { family: "Sartre", given: "J.-P." },
    ]);
  });

  it("turns accent commands, dotless i, escapes, dashes and quotes into text", () => {
    const quoted = "``hi''";

    const decoded = decodeLatex(String.raw`na\"{\i}ve \'{e}t\'e G\"odel \v{S}koda 50\,\% \& co. ${quoted} a--b \emph{x}`);

    expect(decoded).toBe("naïve été Gödel Škoda 50 % & co. “hi” a–b x");
  });
});

describe("normalizeSources and mergeSources", () => {
  it("drops malformed stored sources and keeps the first of each key", () => {
    const sources = normalizeSources([{ key: "ok", type: "BOOK", fields: { Title: "T", bad: 3 }, authors: [{ family: "A", given: "B" }, { nope: true }] }, { key: "OK", fields: {} }, { key: "has space" }, null, "x"]);

    expect(sources).toEqual([{ key: "ok", type: "book", fields: { title: "T" }, authors: [{ family: "A", given: "B" }], editors: [] }]);
    expect(normalizeSources("nope")).toEqual([]);
  });

  it("replaces a source with the same key and appends the new ones", () => {
    const old = parseBibtex("@book{a, title={Old}}\n@book{b, title={B}}").entries;
    const fresh = parseBibtex("@book{A, title={New}}\n@book{c, title={C}}").entries;

    const merged = mergeSources(old, fresh);

    expect(merged.sources.map((entry) => entry.fields.title)).toEqual(["New", "B", "C"]);
    expect(merged.added).toBe(1);
    expect(merged.replaced).toBe(1);
  });

  it("keeps the Jr. part of a name when reading and writing BibTeX", () => {
    const [name] = parseNames("King, Jr., Martin Luther");

    const written = writeBibtex([{ key: "king1963", type: "book", fields: { title: "Strength to Love" }, authors: [name], editors: [] }]);

    expect(name).toEqual({ family: "King", given: "Martin Luther", suffix: "Jr." });
    expect(parseBibtex(written).entries[0].authors).toEqual([name]);
  });
});
