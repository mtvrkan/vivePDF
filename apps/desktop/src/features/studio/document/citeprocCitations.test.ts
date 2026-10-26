import { describe, expect, it } from "vitest";
import type { BibEntry, CitationLanguage, CitationStyle, DocumentNode } from "@/types/studio";
import { parseBibtex } from "./bibtex";
import type { CitationItem } from "./citationItems";
import { buildCitations } from "./cslEngine";
import { entryOfCsl } from "./doiSources";
import records from "./testdata/doiRecords.json";
import { documentHtml } from "./toHtml";

type RecordName = keyof typeof records;

function fetched(name: RecordName): BibEntry {
  const entry = entryOfCsl(JSON.stringify(records[name]), new Set());
  if (!entry) throw new Error(`no entry for ${name}`);
  return { ...entry, key: name };
}

const SOURCES = (Object.keys(records) as RecordName[]).map(fetched);
const item = (key: string, locator = ""): CitationItem => ({ key, locator });
const cite = (...items: CitationItem[]): DocumentNode => ({ type: "citation", attrs: { items } });
const doc = (...nodes: DocumentNode[]): DocumentNode => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] });
const readable = (html: string) => html.replace(/<\/?a\b[^>]*>/g, "").replace(/&#38;/g, "&");

function noted(...items: CitationItem[]): DocumentNode {
  const payload = JSON.stringify(items).replace(/"/g, "&quot;");
  return { type: "footnote", attrs: { text: "See", html: `See <span data-citation="${payload}" class="vp-cite">old</span>` } };
}

async function render(style: CitationStyle, language: CitationLanguage, ...names: RecordName[]) {
  const citations = await buildCitations(doc(...names.map((name) => cite(item(name)))), SOURCES, style, language);
  return { citations, reference: (name: RecordName) => readable(citations.references.find((reference) => reference.includes(records[name].DOI.toLowerCase()) || reference.includes(records[name].DOI)) ?? "") };
}

describe("citeproc citations in APA 7 (en-US)", () => {
  it("writes a journal article reference exactly as APA does", async () => {
    const { reference } = await render("apa", "en-US", "a3_lecun");

    expect(reference("a3_lecun")).toBe("LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. <i>Nature</i>, <i>521</i>(7553), 436–444. https://doi.org/10.1038/nature14539");
  });

  it("writes article numbers, group authors, preprints and data sets", async () => {
    const { reference } = await render("apa", "en-US", "eloc_elsevier", "report_wmo", "preprint_arxiv", "preprint_biorxiv", "dataset_dryad");

    expect(reference("eloc_elsevier")).toContain("<i>Journal of Alloys and Compounds</i>, <i>1001</i>, Article 175192.");
    expect(reference("report_wmo")).toMatch(/^World Meteorological Organization\. \(2025\)\. <i>The role of the World Meteorological Organization/);
    expect(reference("preprint_arxiv")).toContain("(Version 7) [Preprint]. arXiv.");
    expect(reference("preprint_biorxiv")).toContain("[Preprint]. bioRxiv.");
    expect(reference("dataset_dryad")).toContain("(Version 5) [Data set]. Dryad.");
  });

  it("labels one, two and three or more authors and adds the page", async () => {
    const { citations } = await render("apa", "en-US", "a1_bandura", "report_nber", "a3_lecun");

    expect(citations.label([item("a1_bandura")]).text).toBe("(Bandura, 1977)");
    expect(citations.label([item("report_nber")]).text).toBe("(Bailey & Lindo, 2017)");
    expect(citations.label([item("a3_lecun", "436-437")]).text).toBe("(LeCun et al., 2015, pp. 436–437)");
    expect(citations.label([item("a1_bandura"), item("a3_lecun")]).html).toBe("(Bandura, 1977; LeCun et al., 2015)");
  });

  it("lists only the cited sources in alphabetical order, or every source when none is cited", async () => {
    const cited = await render("apa", "en-US", "tr_tunkler", "a3_lecun", "a1_bandura");
    const uncited = await buildCitations(doc(), SOURCES.slice(0, 3), "apa", "en-US");

    expect(cited.citations.references.map((reference) => reference.slice(0, 8))).toEqual(["Bandura,", "LeCun, Y", "Tünkler,"]);
    expect(uncited.references).toHaveLength(3);
  });

  it("adds a/b only for identical author lists and adds names for different ones", async () => {
    const sources = parseBibtex(String.raw`
@book{zed1, author={Zed, Al}, title={One}, publisher={P}, year=2019}
@book{zed2, author={Zed, Al}, title={Two}, publisher={P}, year=2019}
@article{smith1, author={Smith, Ann and Jones, Bo and Brown, Cy}, title={Heat}, journal={J}, year=2020}
@article{smith2, author={Smith, Ann and Lee, Di and Green, Ed}, title={Cold}, journal={J}, year=2020}
`).entries;
    const content = doc(cite(item("zed1")), cite(item("zed2")), cite(item("smith1")), cite(item("smith2")));

    const citations = await buildCitations(content, sources, "apa", "en-US");

    expect(citations.label([item("zed1")], 0).text).toBe("(Zed, 2019a)");
    expect(citations.label([item("zed2")], 1).text).toBe("(Zed, 2019b)");
    expect(citations.label([item("smith1")], 2).text).toBe("(Smith, Jones, et al., 2020)");
    expect(citations.label([item("smith2")], 3).text).toBe("(Smith, Lee, et al., 2020)");
  });

  it("keeps the question mark for keys without a source and escapes source text", async () => {
    const sources = parseBibtex("@misc{bad, author={{World Health Organization}}, title={Report <script>alert(1)</script>}, year=2020}").entries;

    const citations = await buildCitations(doc(cite(item("ghost")), cite(item("bad"))), sources, "apa", "en-US");

    expect(citations.label([item("ghost")])).toEqual({ text: "(ghost?)", html: "(ghost?)", missing: true });
    expect(citations.label([])).toMatchObject({ missing: true });
    expect(citations.label([item("bad"), item("ghost")]).text).toBe("(World Health Organization, 2020) (ghost?)");
    expect(citations.references.join("")).not.toContain("<script>");
  });
});

describe("citeproc citations in the other styles", () => {
  it("writes MLA 9", async () => {
    const { citations, reference } = await render("mla", "en-US", "a3_lecun");

    expect(citations.label([item("a3_lecun", "437")]).text).toBe("(LeCun et al. 437)");
    expect(reference("a3_lecun")).toBe("LeCun, Yann, et al. “Deep Learning.” <i>Nature</i>, vol. 521, no. 7553, May 2015, pp. 436–44, https://doi.org/10.1038/nature14539.");
  });

  it("writes Chicago author-date", async () => {
    const { citations, reference } = await render("chicago", "en-US", "a3_lecun");

    expect(citations.label([item("a3_lecun", "437")]).text).toBe("(LeCun et al. 2015, 437)");
    expect(reference("a3_lecun")).toBe("LeCun, Yann, Yoshua Bengio, and Geoffrey Hinton. 2015. “Deep Learning.” <i>Nature</i> 521 (7553): 436–44. https://doi.org/10.1038/nature14539.");
  });

  it("writes Chicago notes with a full first note and short notes after it", async () => {
    const content = doc(cite(item("a3_lecun", "437")), cite(item("a1_bandura")), cite(item("a3_lecun", "440")));

    const citations = await buildCitations(content, SOURCES, "chicago-notes", "en-US");

    expect(citations.notes).toBe(true);
    expect(citations.label([item("a3_lecun", "437")], 0).html).toBe("Yann LeCun et al., “Deep Learning,” <i>Nature</i> 521, no. 7553 (2015): 437, https://doi.org/10.1038/nature14539.");
    expect(citations.label([item("a3_lecun", "440")], 2).text).toBe("LeCun et al., “Deep Learning,” 440.");
  });

  it("numbers IEEE sources in citation order", async () => {
    const { citations } = await render("ieee", "en-US", "tr_tunkler", "a3_lecun");

    expect(citations.label([item("tr_tunkler")]).text).toBe("[1]");
    expect(citations.label([item("a3_lecun", "437")]).text).toBe("[2, p. 437]");
    expect(citations.references[1]).toBe("[2]&nbsp;Y. LeCun, Y. Bengio, and G. Hinton, “Deep learning,” <i>Nature</i>, vol. 521, no. 7553, pp. 436–444, May 2015, doi: 10.1038/nature14539.");
  });

  it("writes ISNAD in Turkish", async () => {
    const { citations, reference } = await render("isnad", "tr-TR", "a3_lecun");

    expect(citations.label([item("a3_lecun", "437")]).text).toBe("(LeCun vd., 2015, 437)");
    expect(reference("a3_lecun")).toBe("LeCun, Yann vd. “Deep Learning”. <i>Nature</i> 521/7553 (Mayıs 2015), 436-444. https://doi.org/10.1038/nature14539");
  });

  it("writes Vancouver (NLM)", async () => {
    const { citations } = await render("vancouver", "en-US", "a1_bandura", "a3_lecun");

    expect(citations.references[1]).toBe("2.&nbsp;LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015 May;521(7553):436–44. doi:10.1038/nature14539");
  });

  it("writes Harvard (Cite Them Right)", async () => {
    const { citations, reference } = await render("harvard", "en-GB", "a3_lecun");

    expect(citations.label([item("a3_lecun")]).text).toBe("(LeCun, Bengio and Hinton, 2015)");
    expect(reference("a3_lecun")).toBe("LeCun, Y., Bengio, Y. and Hinton, G. (2015) ‘Deep learning’, <i>Nature</i>, 521(7553), pp. 436–444. Available at: https://doi.org/10.1038/nature14539.");
  });

  it("uses the Turkish terms in a Turkish document", async () => {
    const undated = parseBibtex("@book{nodate, author={Yılmaz, Ayşe}, title={Kent ısısı}, publisher={Ankara Yayınları}}").entries;

    const citations = await buildCitations(doc(cite(item("a3_lecun", "12")), cite(item("nodate"))), [...SOURCES, ...undated], "apa", "tr-TR");

    expect(citations.label([item("a3_lecun", "12")], 0).text).toBe("(LeCun vd., 2015, s. 12)");
    expect(citations.label([item("nodate")], 1).text).toBe("(Yılmaz, t.y.)");
  });
});

describe("note styles in the exported HTML", () => {
  it("numbers citation notes and user footnotes in one sequence and keeps a note's citation inside it", async () => {
    const content = doc(cite(item("a3_lecun", "437")), { type: "footnote", attrs: { text: "Own note", html: "Own note" } }, noted(item("a1_bandura")), cite(item("a3_lecun", "440")));
    const citations = await buildCitations(content, SOURCES, "chicago-notes", "en-US");

    const written = documentHtml(content, { fontId: "bundled:dejavu-sans", headingFontId: null }, { citations, title: "Bibliography" });

    expect(written.html).toBe('<p><sup class="fn-ref" id="fnref-1">1</sup><sup class="fn-ref" id="fnref-2">2</sup><sup class="fn-ref" id="fnref-3">3</sup><sup class="fn-ref" id="fnref-4">4</sup></p>');
    expect(written.footnoteHtml[0]).toBe("Yann LeCun et al., “Deep Learning,” <i>Nature</i> 521, no. 7553 (2015): 437, https://doi.org/10.1038/nature14539.");
    expect(written.footnoteHtml[1]).toBe("Own note");
    expect(written.footnoteHtml[2]).toMatch(/^See Albert Bandura, “Self-Efficacy/);
    expect(written.footnoteHtml[3]).toBe("LeCun et al., “Deep Learning,” 440.");
    expect(written.footnotes[3]).toBe("LeCun et al., “Deep Learning,” 440.");
  });
});

describe("Turkish reference lists", () => {
  const library = (text: string) => parseBibtex(text).entries;

  it("writes İçinde with a dotted capital in a Turkish chapter reference", async () => {
    const { reference } = await render("apa", "tr-TR", "chapter_unet");

    expect(reference("chapter_unet")).toContain(". İçinde ");
    expect(reference("chapter_unet")).not.toContain("Içinde");
  });

  it("lowers shouted surnames the Turkish way and leaves out nicknames, whatever the source file says", async () => {
    const sources = library(`@article{tip, author={KARAARSLAN, Fatih and YILMAZ, Halim}, title={Topuk Ağrısı Olan Hastalar}, journal={Sakarya Medical Journal}, year={2021}}
@book{baker, author={Baker, Elizabeth (Betsy) A.}, title={Crafting Questions}, publisher={SAGE}, year={2022}}`);

    const citations = await buildCitations(doc(cite(item("tip")), cite(item("baker"))), sources, "apa", "tr-TR");

    expect(citations.references.map(readable)).toEqual([
      "Baker, E. A. (2022). <i>Crafting Questions</i>. SAGE.",
      "Karaarslan, F., & Yılmaz, H. (2021). Topuk Ağrısı Olan Hastalar. <i>Sakarya Medical Journal</i>.",
    ]);
  });

  it("does not put a book's series in front of it as if it were a chapter", async () => {
    const sources = library("@book{esl, title={The Elements of Statistical Learning}, journal={Springer Series in Statistics}, publisher={Springer}, author={Hastie, Trevor}, year={2009}}");

    const citations = await buildCitations(doc(cite(item("esl"))), sources, "apa", "tr-TR");

    expect(readable(citations.references[0])).toBe("Hastie, T. (2009). <i>The Elements of Statistical Learning</i>. Springer.");
  });

  it("keeps a Turkish title as typed when an English citation quotes it for a source without authors", async () => {
    const sources = library("@inproceedings{icmar, title={Derin öğrenme ile gül yaprağı tespiti}, booktitle={ICMAR 2023}, year={2023}}");

    const citations = await buildCitations(doc(cite(item("icmar"))), sources, "apa", "en-US");

    expect(citations.label([item("icmar")]).text).toBe("(“Derin öğrenme ile gül yaprağı tespiti,” 2023)");
  });

  it("writes In without a dotted capital when an English list holds a Turkish chapter", async () => {
    const sources = library("@incollection{goc, author={Yıldız, Hülya}, title={Göç ve kimlik}, booktitle={Türkiye'de Toplumsal Değişme}, editor={Şahin, Can}, publisher={İletişim}, year={2018}, language={turkish}}");

    const citations = await buildCitations(doc(cite(item("goc"))), sources, "apa", "en-US");

    expect(readable(citations.references[0])).toContain(". In C. Şahin (Ed.), ");
  });

  it("names a thesis in the language of the reference list unless the source names it", async () => {
    const sources = library(`@thesis{arslan, author={Arslan, Burak}, title={Derin öğrenme}, institution={ODTÜ}, type={mathesis}, year={2021}}
@phdthesis{kaya, author={Kaya, Zeynep}, title={Eğitim politikaları}, school={Hacettepe Üniversitesi}, year={2019}, type={Sanatta yeterlik tezi}}`);

    const turkish = await buildCitations("", sources, "apa", "tr-TR");
    const english = await buildCitations("", sources, "apa", "en-US");

    expect(turkish.references.map(readable)).toEqual(["Arslan, B. (2021). <i>Derin öğrenme</i> [Yüksek lisans tezi]. ODTÜ.", "Kaya, Z. (2019). <i>Eğitim politikaları</i> [Sanatta yeterlik tezi]. Hacettepe Üniversitesi."]);
    expect(readable(english.references[0])).toContain("[Master’s thesis]");
  });

  it("links a DOI once when the source file writes it as a doi.org address", async () => {
    const sources = library("@article{dna, author={Smith, John}, title={DNA repair}, journal={Nature Communications}, year={2021}, doi={https://doi.org/10.1038/s41467-021-23000-0}}");

    const citations = await buildCitations("", sources, "apa", "en-US");

    expect(readable(citations.references[0])).toContain(" https://doi.org/10.1038/s41467-021-23000-0");
    expect(citations.references[0]).not.toContain("doi.org/https");
  });

  it("writes et al. for a BibTeX author list that ends in and others, in the list's language", async () => {
    const sources = library("@article{duo, author={Ertuğrul, Beril and others}, title={Kısa not}, journal={Dergi}, year={2022}}");

    const english = await buildCitations(doc(cite(item("duo"))), sources, "apa", "en-US");
    const isnad = await buildCitations(doc(cite(item("duo"))), sources, "isnad", "tr-TR");

    expect(readable(english.references[0])).toMatch(/^Ertuğrul, B\., et al\. \(2022\)\. Kısa not\./);
    expect(english.label([item("duo")]).text).toBe("(Ertuğrul et al., 2022)");
    expect(readable(isnad.references[0])).toMatch(/^Ertuğrul, Beril vd\. /);
    expect(english.references[0]).not.toContain("others");
  });

  it("reads an institution split like a person's name as the institution, and drops HTML tags from a title", async () => {
    const sources = library(`@techreport{ifpri, author={Policy Institute, International Food}, title={Global food policy report}, institution={IFPRI}, year={2022}}
@article{lme4, author={Bates, Douglas}, title={Fitting Linear Mixed-Effects Models Using <b>lme4</b>}, journal={Journal of Statistical Software}, year={2015}}`);

    const citations = await buildCitations("", sources, "apa", "en-US");

    expect(citations.references.map(readable)).toEqual([
      "Bates, D. (2015). Fitting Linear Mixed-Effects Models Using lme4. <i>Journal of Statistical Software</i>.",
      "International Food Policy Institute. (2022). <i>Global food policy report</i>. IFPRI.",
    ]);
  });

  it("writes an electronic page range with a dash in English and with the Turkish hyphen in Turkish", async () => {
    const sources = library("@article{cell, author={Hoffmann, Markus}, title={Cell entry}, journal={Cell}, volume={181}, number={2}, pages={271-280.e8}, year={2020}}");

    const english = await buildCitations("", sources, "apa", "en-US");
    const turkish = await buildCitations("", sources, "apa", "tr-TR");

    expect(readable(english.references[0])).toContain("181</i>(2), 271–280.e8.");
    expect(readable(turkish.references[0])).toContain("181</i>(2), 271-280.e8.");
  });

  it("sorts the reference list in Turkish alphabetical order", async () => {
    const names = ["Şahin", "Ünal", "Cengiz", "İnce", "Öztürk", "Işık", "Çelik", "Uslu", "Ozan", "Sarı", "Ilgaz"];
    const sources: BibEntry[] = names.map((family, index) => ({ key: `k${index}`, type: "article", fields: { title: `Başlık ${index}`, journal: "Dergi", year: "2020" }, authors: [{ family, given: "Ali" }], editors: [] }));

    const citations = await buildCitations("", sources, "apa", "tr-TR");

    expect(citations.references.map((reference) => names.find((name) => reference.startsWith(name)))).toEqual(["Cengiz", "Çelik", "Ilgaz", "Işık", "İnce", "Ozan", "Öztürk", "Sarı", "Şahin", "Uslu", "Ünal"]);
  });
});
