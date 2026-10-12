import { describe, expect, it } from "vitest";
import type { BibEntry } from "@/types/studio";
import { applyChanges, checkedDois, checksByDoi, doiKey, doiLink, entryOfCsl, leadingNotice, sourceChanges } from "./doiSources";

const NATURE = JSON.stringify({
  id: "https://doi.org/10.1038/nature12373",
  type: "article-journal",
  DOI: "10.1038/nature12373",
  title: ["Nanometre-scale <i>thermometry</i> in a living cell"],
  "container-title": "Nature",
  volume: "500",
  issue: "7460",
  page: "54-58",
  issued: { "date-parts": [[2013, 7, 31]] },
  author: [
    { family: "Kucsko", given: "G." },
    { family: "Lukin", given: "M. D." },
  ],
});

function entry(fields: Record<string, string>, key = "kucsko2013"): BibEntry {
  return { key, type: "article", fields, authors: [{ family: "Kucsko", given: "G." }], editors: [] };
}

describe("doiSources", () => {
  it("turns a doi.org CSL record into a source with a made-up key and plain-text title", () => {
    const source = entryOfCsl(NATURE, new Set(["kucsko2013nanometresca"]));

    expect(source?.key).toBe("kucsko2013nanometrescaa");
    expect(source?.fields).toMatchObject({ title: "Nanometre-scale thermometry in a living cell", journal: "Nature", volume: "500", number: "7460", pages: "54-58", year: "2013", doi: "10.1038/nature12373" });
    expect(source?.authors).toHaveLength(2);
  });

  it("returns nothing for an answer that is not one CSL object", () => {
    expect(entryOfCsl("not json", new Set())).toBeNull();
    expect(entryOfCsl("[1, 2]", new Set())).toBeNull();
  });

  it("matches DOIs written as links, with a prefix or in another case", () => {
    expect(doiKey(" https://doi.org/10.1038/NATURE12373 ")).toBe("10.1038/nature12373");
    expect(doiKey("doi: 10.1038/nature12373")).toBe("10.1038/nature12373");
    expect(doiLink("10.1016/S0140-6736(97)11096-0")).toBe("https://doi.org/10.1016/S0140-6736(97)11096-0");
    expect(checkedDois([entry({ doi: "10.1/a" }), entry({ doi: "https://doi.org/10.1/A" }), entry({}), entry({ doi: "10.1/b" })])).toEqual(["10.1/a", "10.1/b"]);
  });

  it("pairs check results with the DOIs that were sent and points at the retraction first", () => {
    const retracted = { doi: "10.1/a", status: "retracted" as const, publishedVersion: null, notices: [{ type: "correction", doi: "10.1/c", date: null, source: null }, { type: "retraction", doi: "10.1/r", date: "2010-02-06", source: null }] };

    const checks = checksByDoi(["https://doi.org/10.1/A"], [retracted]);

    expect(checks["10.1/a"]).toBe(retracted);
    expect(leadingNotice(retracted)).toBe("10.1/r");
  });

  it("lists only fields the published record changes and applies them without touching the key", () => {
    const current = entry({ title: "Nanometre-scale thermometry in a living cell", journal: "Nature", year: "2013", note: "mine" });
    const fetched = entryOfCsl(NATURE, new Set()) as BibEntry;

    const changes = sourceChanges(current, fetched);
    const updated = applyChanges(current, fetched, changes);

    expect(changes.map((change) => change.field)).toEqual(["volume", "number", "pages", "authors"]);
    expect(updated.key).toBe("kucsko2013");
    expect(updated.fields).toMatchObject({ volume: "500", pages: "54-58", note: "mine" });
    expect(updated.authors).toHaveLength(2);
    expect(sourceChanges(updated, fetched)).toEqual([]);
  });
});
