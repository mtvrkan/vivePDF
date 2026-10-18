import { describe, expect, it } from "vitest";
import type { DocumentNode } from "@/types/studio";
import { parseBibtex } from "./bibtex";
import type { CitationItem } from "./citationItems";
import { buildCitations, citedKeys, type CitationTerms } from "./citations";

const TERMS: CitationTerms = {
  and: "and",
  etAl: "et al.",
  page: "p.",
  pages: "pp.",
  noDate: "n.d.",
  in: "In",
  editor: "Ed.",
  editors: "Eds.",
  editedBy: "edited by",
  edition: "{ord} ed.",
  volume: "vol.",
  issue: "no.",
  doctoral: "Doctoral dissertation",
  masters: "Master's thesis",
  thesis: "Thesis",
  report: "Report No.",
  available: "Available",
};

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
  it("writes APA 7 labels and an alphabetical reference list with year letters for same-author works", () => {
    const content = doc(cite(item("zed2019b")), cite(item("smith2020", "12-14")), cite(item("brown2018"), item("zed2019a", "5")));

    const citations = buildCitations(content, SOURCES, "apa", TERMS, "en");

    expect(citations.label([item("smith2020", "12-14")]).text).toBe("(Smith & Lee, 2020, pp. 12–14)");
    expect(citations.label([item("brown2018"), item("zed2019a", "5")]).text).toBe("(Brown et al., 2018; Zed, 2019a, p. 5)");
    expect(citations.label([item("zed2019b")]).text).toBe("(Zed, 2019b)");
    expect(citations.references).toEqual([
      "Brown, A., Green, B., & White, C. (2018). <em>Designing Things</em> (2nd ed.). Acme Press.",
      'Smith, J. A., & Lee, M. (2020). Cities and heat. <em>Urban Studies</em>, <em>12</em>(3), 45–67. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>',
      "Zed, A. (2019a). First part. In I. Ed &amp; E. Tor (Eds.), <em>Big Collection</em> (pp. 1–10). Pub.",
      "Zed, A. (2019b). Second part. In <em>Big Collection</em>. Pub.",
    ]);
  });

  it("numbers IEEE sources by first citation and lists only what the text cites", () => {
    const content = doc(cite(item("brown2018")), cite(item("smith2020", "4"), item("brown2018")));

    const citations = buildCitations(content, SOURCES, "ieee", TERMS, "en");

    expect(citations.label([item("smith2020", "4"), item("brown2018")]).text).toBe("[2, p. 4], [1]");
    expect(citations.references).toEqual([
      "[1]&nbsp;A. Brown, B. Green, and C. White, <em>Designing Things</em>, 2nd ed. Boston: Acme Press, 2018.",
      '[2]&nbsp;J. A. Smith and M. Lee, “Cities and heat,” <em>Urban Studies</em>, vol. 12, no. 3, pp. 45–67, 2020. Available: <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>',
    ]);
  });

  it("writes MLA and Chicago author-date entries in their own shapes", () => {
    const content = doc(cite(item("smith2020", "50")));

    const mla = buildCitations(content, SOURCES, "mla", TERMS, "en");
    const chicago = buildCitations(content, SOURCES, "chicago", TERMS, "en");

    expect(mla.label([item("smith2020", "50")]).text).toBe("(Smith and Lee 50)");
    expect(mla.references[0]).toBe('Smith, John A., and Mary Lee. “Cities and heat.” <em>Urban Studies</em>, vol. 12, no. 3, 2020, pp. 45–67. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>.');
    expect(chicago.label([item("smith2020", "50")]).text).toBe("(Smith and Lee 2020, 50)");
    expect(chicago.references[0]).toBe('Smith, John A., and Mary Lee. 2020. “Cities and heat.” <em>Urban Studies</em> 12 (3): 45–67. <a href="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</a>');
  });

  it("lists every source while nothing is cited, escapes their text and marks undated works", () => {
    const citations = buildCitations(doc(), SOURCES, "apa", TERMS, "en");

    const who = citations.references.find((reference) => reference.startsWith("World Health Organization"));

    expect(citations.references).toHaveLength(SOURCES.length);
    expect(who).toBe('World Health Organization. (n.d.). <em>Report &lt;script&gt;alert(1)&lt;/script&gt;</em>. <a href="https://who.int/x">https://who.int/x</a>');
    expect(citations.label([item("undated")]).text).toBe("(World Health Organization, n.d.)");
  });

  it("flags citations of sources that are gone instead of dropping them", () => {
    const citations = buildCitations(doc(cite(item("ghost"))), SOURCES, "apa", TERMS, "en");
    const numbered = buildCitations(doc(cite(item("ghost"))), SOURCES, "ieee", TERMS, "en");

    expect(citations.label([item("ghost")])).toEqual({ text: "(ghost?)", missing: true });
    expect(numbered.label([item("ghost")])).toEqual({ text: "[?]", missing: true });
    expect(citations.label([]).missing).toBe(true);
  });
});

describe("citations inside footnotes", () => {
  it("counts a footnote's citations at the footnote's place in the text", () => {
    const content = doc(cite(item("smith2020")), noted(item("brown2018"), item("smith2020")), cite(item("undated")));

    const numbered = buildCitations(content, SOURCES, "ieee", TERMS, "en");

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

