import { describe, expect, it } from "vitest";
import { cslItemOf, parseCslJson } from "./cslJson";
import { entryOfCsl, normalizedDoi, plainText } from "./doiSources";
import records from "./testdata/doiRecords.json";

type RecordName = keyof typeof records;

function fetched(name: RecordName) {
  const entry = entryOfCsl(JSON.stringify(records[name]), new Set());
  if (!entry) throw new Error(`no entry for ${name}`);
  return entry;
}

describe("cslJson with real doi.org records", () => {
  it("files Crossref journal articles, chapters and conference papers under their own types", () => {
    const article = fetched("a3_lecun");
    const chapter = fetched("chapter_unet");
    const paper = fetched("conf_resnet");

    expect(article.type).toBe("article");
    expect(article.fields).toMatchObject({ journal: "Nature", volume: "521", number: "7553", pages: "436-444", year: "2015" });
    expect(chapter.type).toBe("incollection");
    expect(chapter.fields.booktitle).toBe("Lecture Notes in Computer Science");
    expect(paper.type).toBe("inproceedings");
    expect(cslItemOf(article).type).toBe("article-journal");
    expect(cslItemOf(chapter).type).toBe("chapter");
    expect(cslItemOf(paper).type).toBe("paper-conference");
  });

  it("reads a shouted surname as Turkish when the title is Turkish, even without a language field", () => {
    const record = {
      type: "journal-article",
      DOI: "10.31832/smj.984680",
      title: "Unilateral Plantar Topuk Ağrısı Olan Hastalarda Termal Peloid Tedavisi",
      "container-title": "Sakarya Medical Journal",
      author: [
        { given: "Halim", family: "YILMAZ" },
        { given: "Elizabeth (Betsy) A.", family: "Baker" },
      ],
      issued: { "date-parts": [[2021, 11, 1]] },
    };

    const entry = entryOfCsl(JSON.stringify(record), new Set());

    expect(entry?.authors).toEqual([
      { family: "Yılmaz", given: "Halim" },
      { family: "Baker", given: "Elizabeth A." },
    ]);
  });

  it("keeps a group author that Crossref sends as a plain name", () => {
    const report = fetched("report_wmo");

    expect(report.type).toBe("techreport");
    expect(report.authors).toEqual([{ family: "World Meteorological Organization", given: "", literal: true }]);
    expect(cslItemOf(report).author).toEqual([{ literal: "World Meteorological Organization" }]);
  });

  it("stores article numbers apart from pages and hands them to CSL as the number", () => {
    const natureCommunications = fetched("eloc_natcomm");
    const elsevier = fetched("eloc_elsevier");
    const plos = fetched("eloc_plos");

    expect(natureCommunications.fields.eid).toBeTruthy();
    expect(elsevier.fields.eid).toBe("175192");
    expect(elsevier.fields.pages).toBeUndefined();
    expect(plos.fields.eid).toBe("e124");
    expect(cslItemOf(elsevier)).toMatchObject({ type: "article-journal", number: "175192" });
    expect(cslItemOf(elsevier).page).toBeUndefined();
  });

  it("keeps the last author of a very long author list, as APA prints it", () => {
    const ligo = fetched("org_ligo");

    expect(ligo.authors).toHaveLength(200);
    expect(ligo.authors[0].family).toBe("Abbott");
    expect(ligo.authors[199]).toEqual({ family: "LIGO Scientific Collaboration and Virgo Collaboration", given: "", literal: true });
  });

  it("marks preprints with their archive and gives them back to CSL as preprints", () => {
    const arxiv = fetched("preprint_arxiv");
    const biorxiv = fetched("preprint_biorxiv");

    expect(arxiv).toMatchObject({ type: "online", fields: { pubstate: "preprint", eprinttype: "arXiv", version: "7" } });
    expect(biorxiv.fields.eprinttype).toBe("bioRxiv");
    expect(cslItemOf(biorxiv)).toMatchObject({ type: "article", publisher: "bioRxiv" });
  });

  it("keeps data sets and software as their own kinds", () => {
    const dataset = fetched("dataset_dryad");
    const software = fetched("dataset_zenodo");

    expect(dataset).toMatchObject({ type: "dataset", fields: { publisher: "Dryad", version: "5" } });
    expect(software.type).toBe("software");
    expect(cslItemOf(software)).toMatchObject({ type: "software", publisher: "Zenodo", version: "v3.1.0" });
  });

  it("writes surnames that Crossref sends in capitals the way people write them", () => {
    const turkish = fetched("tr_tunkler");

    expect(turkish.authors[0]).toMatchObject({ family: "Tünkler", given: "Vural" });
    expect(parseCslJson(JSON.stringify([{ type: "article-journal", title: "x", author: [{ family: "IŞIK", given: "İLKER" }] }])).entries[0].authors[0]).toMatchObject({ family: "Işık", given: "İlker" });
    expect(parseCslJson(JSON.stringify([{ type: "article-journal", title: "x", author: [{ family: "ISAAC", given: "J." }] }])).entries[0].authors[0].family).toBe("Isaac");
  });

  it("keeps a name suffix such as Jr. through CSL", () => {
    const entry = parseCslJson(JSON.stringify([{ type: "article-journal", title: "x", author: [{ family: "Adams", given: "Reginald B.", suffix: "Jr." }] }])).entries[0];

    expect(entry.authors[0]).toEqual({ family: "Adams", given: "Reginald B.", suffix: "Jr." });
    expect(cslItemOf(entry).author).toEqual([{ family: "Adams", given: "Reginald B.", suffix: "Jr." }]);
  });

  it("turns title markup into readable text without gluing or splitting words", () => {
    expect(fetched("tags_g3").fields.title).toBe("Microenvironmental Gene Expression Plasticity Among Individual Drosophila melanogaster");
    expect(plainText("H<sub>2</sub>O and CO<sub>2</sub> &amp; x&lt;y")).toBe("H2O and CO2 & x<y");
    expect(plainText("<jats:p>First.</jats:p><jats:p>Second.</jats:p>")).toBe("First. Second.");
  });
});

describe("normalizedDoi", () => {
  it("finds the DOI in links, publisher pages and pasted text", () => {
    expect(normalizedDoi("https://www.doi.org/10.1038/nature14539")).toBe("10.1038/nature14539");
    expect(normalizedDoi("doi.org/10.1038/nature14539")).toBe("10.1038/nature14539");
    expect(normalizedDoi("(10.1038/nature14539)")).toBe("10.1038/nature14539");
    expect(normalizedDoi("https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9280.2009.02437.x")).toBe("10.1111/j.1467-9280.2009.02437.x");
    expect(normalizedDoi("https://link.springer.com/chapter/10.1007/978-3-319-24574-4_28?utm=x#sec")).toBe("10.1007/978-3-319-24574-4_28");
  });

  it("keeps parentheses that belong to the DOI and drops trailing punctuation", () => {
    expect(normalizedDoi("doi:10.1016/S0140-6736(97)11096-0).")).toBe("10.1016/S0140-6736(97)11096-0");
    expect(normalizedDoi("https://doi.org/10.1038%2Fnature14539.")).toBe("10.1038/nature14539");
  });

  it("returns nothing for text without a DOI", () => {
    expect(normalizedDoi("nature article")).toBeNull();
  });
});

describe("cslItemOf with biblatex fields", () => {
  it("dates an entry from its full date and joins the subtitle to the title", () => {
    const entry = { key: "k", type: "online", fields: { title: "Living with heat", subtitle: "A guide", date: "2023-07-14" }, authors: [], editors: [] };

    expect(cslItemOf(entry)).toMatchObject({ title: "Living with heat: A guide", issued: { "date-parts": [[2023, 7, 14]] } });
    expect(cslItemOf({ ...entry, fields: { title: "Why?", subtitle: "Because", year: "2020", date: "2023-07-14" } })).toMatchObject({ title: "Why? Because", issued: { "date-parts": [[2020]] } });
  });
});
