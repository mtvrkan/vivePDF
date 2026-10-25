import { describe, expect, it } from "vitest";
import type { DocumentNode } from "@/types/studio";
import { parseBibtex } from "./bibtex";
import type { CitationItem } from "./citationItems";
import { citedKeys, sourceMatches } from "./citations";
import { buildCitations } from "./cslEngine";

const SOURCES = parseBibtex(String.raw`
@article{smith2020, author={Smith, John A. and Lee, Mary}, title={Cities and heat}, journal={Urban Studies}, year=2020, volume=12, number=3, pages={45--67}, doi={10.1000/xyz}}
@book{brown2018, author={Brown, Ann and Green, Bo and White, Cy}, title={Designing Things}, publisher={Acme Press}, address={Boston}, year=2018, edition=2}
@incollection{zed2019a, author={Zed, Al}, title={First part}, booktitle={Big Collection}, editor={Ed, Ina and Tor, Ed}, publisher={Pub}, year=2019, pages={1--10}}
@incollection{zed2019b, author={Zed, Al}, title={Second part}, booktitle={Big Collection}, publisher={Pub}, year=2019}
@misc{undated, author={{World Health Organization}}, title={Report <script>alert(1)</script>}, url={https://who.int/x}}
`).entries;

function cite(...items: CitationItem[]): DocumentNode {
  return { type: "citation", attrs: { items } };
}

function doc(...citations: DocumentNode[]): DocumentNode {
  return { type: "doc", content: [{ type: "paragraph", content: citations }] };
}

const item = (key: string, locator = ""): CitationItem => ({ key, locator });

function noted(...items: CitationItem[]): DocumentNode {
  const payload = JSON.stringify(items).replace(/"/g, "&quot;");
  return { type: "footnote", attrs: { text: "See", html: `See <span data-citation="${payload}" class="vp-cite">old</span>` } };
}

describe("buildCitations", () => {
  it("writes APA 7 labels and an alphabetical reference list with year letters for same-author works", async () => {
    const content = doc(cite(item("zed2019b")), cite(item("smith2020", "12-14")), cite(item("brown2018"), item("zed2019a", "5")));

    const citations = await buildCitations(content, SOURCES, "apa", "en-US");

    expect(citations.label([item("smith2020", "12-14")]).text).toBe("(Smith & Lee, 2020, pp. 12–14)");
    expect(citations.label([item("brown2018"), item("zed2019a", "5")]).text).toBe("(Brown et al., 2018; Zed, 2019a, p. 5)");
    expect(citations.label([item("zed2019b")]).text).toBe("(Zed, 2019b)");
    expect(citations.references).toEqual([
      "Brown, A., Green, B., &#38; White, C. (2018). <i>Designing Things</i> (2nd ed.). Acme Press.",
      'Smith, J. A., &#38; Lee, M. (2020). Cities and heat. <i>Urban Studies</i>, <i>12</i>(3), 45–67. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>',
      "Zed, A. (2019a). First part. In I. Ed &#38; E. Tor (Eds.), <i>Big Collection</i> (pp. 1–10). Pub.",
      "Zed, A. (2019b). Second part. In <i>Big Collection</i>. Pub.",
    ]);
  });

  it("numbers IEEE sources by first citation and lists only what the text cites", async () => {
    const content = doc(cite(item("brown2018")), cite(item("smith2020", "4"), item("brown2018")));

    const citations = await buildCitations(content, SOURCES, "ieee", "en-US");

    expect(citations.label([item("smith2020", "4"), item("brown2018")]).text).toBe("[1], [2, p. 4]");
    expect(citations.references).toEqual([
      "[1]&nbsp;A. Brown, B. Green, and C. White, <i>Designing Things</i>, 2nd ed. Boston: Acme Press, 2018.",
      "[2]&nbsp;J. A. Smith and M. Lee, “Cities and heat,” <i>Urban Studies</i>, vol. 12, no. 3, pp. 45–67, 2020, doi: 10.1000/xyz.",
    ]);
  });

  it("writes MLA and Chicago author-date entries in their own shapes", async () => {
    const content = doc(cite(item("smith2020", "50")));

    const mla = await buildCitations(content, SOURCES, "mla", "en-US");
    const chicago = await buildCitations(content, SOURCES, "chicago", "en-US");

    expect(mla.label([item("smith2020", "50")]).text).toBe("(Smith and Lee 50)");
    expect(mla.references[0]).toBe('Smith, John A., and Mary Lee. “Cities and Heat.” <i>Urban Studies</i>, vol. 12, no. 3, 2020, pp. 45–67, <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>.');
    expect(chicago.label([item("smith2020", "50")]).text).toBe("(Smith and Lee 2020, 50)");
    expect(chicago.references[0]).toBe('Smith, John A., and Mary Lee. 2020. “Cities and Heat.” <i>Urban Studies</i> 12 (3): 45–67. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>.');
  });

  it("lists every source while nothing is cited, escapes their text and marks undated works", async () => {
    const citations = await buildCitations(doc(), SOURCES, "apa", "en-US");

    const who = citations.references.find((reference) => reference.startsWith("World Health Organization"));

    expect(citations.references).toHaveLength(SOURCES.length);
    expect(who).toBe('World Health Organization. (n.d.). <i>Report &#60;script&#62;alert(1)&#60;/script&#62;</i>. Retrieved <a href="https://who.int/x">https://who.int/x</a>');
    expect(citations.label([item("undated")]).text).toBe("(World Health Organization, n.d.)");
  });

  it("escapes markup in author and editor names in every style", async () => {
    const sources = parseBibtex(String.raw`
@book{bad, author={<b>Evil</b>, <img src=x>}, title={T}, publisher={P}, year=2020}
@book{eds, editor={<i>Ed</i>, Al}, title={E}, publisher={P}, year=2021}
`).entries;

    const written = (await Promise.all((["apa", "mla", "chicago", "ieee"] as const).map((style) => buildCitations(doc(), sources, style, "en-US")))).flatMap((citations) => citations.references);

    expect(written).toHaveLength(8);
    for (const reference of written) {
      expect(reference).not.toMatch(/<b>|<img|<i>Ed/);
    }
    expect(written.join("\n")).toContain("&#60;b&#62;Evil&#60;/b&#62;");
    expect(written.join("\n")).toContain("&#60;i&#62;Ed&#60;/i&#62;");
  });

  it("flags citations of sources that are gone instead of dropping them", async () => {
    const citations = await buildCitations(doc(cite(item("ghost"))), SOURCES, "apa", "en-US");
    const numbered = await buildCitations(doc(cite(item("ghost"))), SOURCES, "ieee", "en-US");

    expect(citations.label([item("ghost")])).toEqual({ text: "(ghost?)", html: "(ghost?)", missing: true });
    expect(numbered.label([item("ghost")])).toEqual({ text: "[?]", html: "[?]", missing: true });
    expect(citations.label([]).missing).toBe(true);
  });
});

describe("citations inside footnotes", () => {
  it("counts a footnote's citations at the footnote's place in the text", async () => {
    const content = doc(cite(item("smith2020")), noted(item("brown2018"), item("smith2020")), cite(item("undated")));

    const numbered = await buildCitations(content, SOURCES, "ieee", "en-US");

    expect(citedKeys(content)).toEqual(["smith2020", "brown2018", "undated"]);
    expect(numbered.label([item("brown2018")]).text).toBe("[2]");
    expect(numbered.references).toHaveLength(3);
  });

  it("ignores footnotes without citations and damaged citation markup", () => {
    const plain: DocumentNode = { type: "footnote", attrs: { text: "x", html: "<em>x</em>" } };
    const broken: DocumentNode = { type: "footnote", attrs: { text: "x", html: '<span data-citation="[{not json">x</span>' } };

    expect(citedKeys(doc(plain, broken, cite(item("zed2019a"))))).toEqual(["zed2019a"]);
  });
});


describe("sourceMatches", () => {
  const [entry] = parseBibtex("@book{isik2020, author = {IŞIK, Ayşe}, title = {İSTANBUL NOTLARI}, year = {2020}}").entries;

  it("finds Turkish capitals typed in lower case under a Turkish interface", () => {
    expect(sourceMatches(entry, "ışık", "tr")).toBe(true);
    expect(sourceMatches(entry, "istanbul", "tr")).toBe(true);
  });

  it("matches every source when nothing is typed", () => {
    expect(sourceMatches(entry, "", "tr")).toBe(true);
  });

  it("does not match a word the source does not contain", () => {
    expect(sourceMatches(entry, "ankara", "tr")).toBe(false);
  });
});
