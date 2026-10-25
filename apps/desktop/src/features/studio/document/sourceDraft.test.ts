import { describe, expect, it } from "vitest";
import type { BibEntry } from "@/types/studio";
import { cslItemOf } from "./cslJson";
import { draftOf, entryOfDraft, fieldNameOf, otherFields, shownFields, slotLabel } from "./sourceDraft";

const ARXIV: BibEntry = { key: "vaswani2017", type: "online", fields: { title: "Attention is all you need", year: "2017", eprinttype: "arXiv", eprint: "1706.03762" }, authors: [{ family: "Vaswani", given: "Ashish" }], editors: [] };

describe("source draft fields", () => {
  it("edits biblatex names in the slot of their BibTeX twin", () => {
    const fields = { title: "T", date: "2020-05-01", journaltitle: "Nature", location: "London" };

    const shown = shownFields("article", fields);

    expect(shown.slice(0, 2)).toEqual(["date", "journaltitle"]);
    expect(shown).not.toContain("year");
    expect(shown.map(slotLabel)).toContain("journal");
    expect(shownFields("article", { ...fields, journaltitle: "" })).toContain("journaltitle");
    expect(shownFields("article", { journal: "Science", journaltitle: "Nature" })).toContain("journal");
  });

  it("lists every field the form does not show, empty ones included", () => {
    expect(otherFields("article", { title: "T", year: "2020", abstract: "Long", keywords: "", issn: "1234-5678" })).toEqual(["abstract", "keywords", "issn"]);
    expect(otherFields("conference", { booktitle: "Proc", eventtitle: "ICML" })).toEqual(["eventtitle"]);
  });

  it("accepts BibTeX field names only", () => {
    expect(fieldNameOf(" Keywords ")).toBe("keywords");
    expect(fieldNameOf("author")).toBeNull();
    expect(fieldNameOf("1st")).toBeNull();
    expect(fieldNameOf("two words")).toBeNull();
    expect(fieldNameOf("")).toBeNull();
  });
});

describe("preprints in the editor", () => {
  it("opens an arXiv record as a preprint and saves it back unchanged", () => {
    const draft = draftOf(ARXIV);

    expect(draft.type).toBe("preprint");
    expect(entryOfDraft(draft, ARXIV, new Set())).toEqual(ARXIV);
  });

  it("stores a new preprint as an online entry the styles label as a preprint", () => {
    const entry = entryOfDraft({ type: "preprint", key: "", authors: "Doe, Jane", editors: "", fields: { title: "A result", year: "2024" } }, null, new Set());

    expect(entry.type).toBe("online");
    expect(entry.fields.pubstate).toBe("preprint");
    expect(cslItemOf(entry)).toMatchObject({ type: "article", genre: "Preprint" });
  });

  it("drops the preprint mark when the type is changed", () => {
    const marked: BibEntry = { ...ARXIV, fields: { title: "T", year: "2017", pubstate: "preprint" } };

    expect(entryOfDraft({ ...draftOf(marked), type: "article" }, marked, new Set()).fields).toEqual({ title: "T", year: "2017" });
  });
});
