import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BibEntry } from "@/types/studio";
import { parseBibtex, type BibLibrary } from "./bibtex";
import { writeBack } from "./bibtexWriteBack";

const CORPUS = join(__dirname, "testdata", "bib");
const FILES = readdirSync(CORPUS).filter((name) => name.endsWith(".bib"));

function read(name: string): string {
  return readFileSync(join(CORPUS, name), "utf8");
}

function opened(name: string): { entries: BibEntry[]; library: BibLibrary; skipped: number } {
  const result = parseBibtex(read(name));
  if (!result.library) throw new Error("no library");
  return { entries: result.entries, library: result.library, skipped: result.skipped };
}

function byKey(entries: BibEntry[], key: string): BibEntry {
  const found = entries.find((entry) => entry.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
}

describe("BibTeX library write-back", () => {
  it.each(FILES)("writes %s back byte for byte when nothing changed", (name) => {
    const { entries, library } = opened(name);

    const written = writeBack(library, entries);

    expect(written).toBe(read(name));
  });

  it("rewrites only the edited entry and keeps its field order, layout and untouched raw values", () => {
    const { entries, library } = opened("dblp.bib");
    const target = byKey(entries, "DBLP:conf/nips/VaswaniSPUJGKP17");
    const edited = entries.map((entry) => (entry === target ? { ...entry, fields: { ...entry.fields, pages: "5998-6009", note: "Spotlight" } } : entry));

    const written = writeBack(library, edited);

    const original = read("dblp.bib");
    const editedEntry = written.slice(written.indexOf("@inproceedings{DBLP:conf/nips/VaswaniSPUJGKP17"), written.indexOf("@inproceedings{DBLP:conf/cvpr/HeZRS16"));
    expect(editedEntry).toContain("  pages        = {5998-6009}");
    expect(editedEntry).toContain("  note         = {Spotlight}");
    expect(editedEntry).toContain("Long Beach, CA, {USA}},");
    expect(editedEntry.indexOf("title")).toBeLessThan(editedEntry.indexOf("booktitle"));
    expect(written.slice(written.indexOf("@inproceedings{DBLP:conf/cvpr/HeZRS16"))).toBe(original.slice(original.indexOf("@inproceedings{DBLP:conf/cvpr/HeZRS16")));
    expect(byKey(parseBibtex(written).entries, "DBLP:conf/nips/VaswaniSPUJGKP17").fields.pages).toBe("5998-6009");
  });

  it("keeps comments, @string, @preamble and broken entries when another entry is edited", () => {
    const { entries, library } = opened("handwritten.bib");
    const edited = entries.map((entry) => (entry.key === "accents" ? { ...entry, fields: { ...entry.fields, year: "1999" } } : entry));

    const written = writeBack(library, edited);

    expect(written).toContain("% @article{commentedOut, title={Should this load?}}");
    expect(written).toContain('@preamble{ "\\newcommand{\\noopsort}[1]{} \\providecommand{\\url}[1]{#1}" }');
    expect(written).toContain('@string{ jasa = "Journal of the American Statistical Association" }');
    expect(written).toContain("@comment{ This is a free comment with {braces} and an @ sign }");
    expect(written).toContain("  title = {{Quantum} {Mechanics} for {Turkish} {Students} in {İstanbul}},");
    expect(written).toContain("@article{macro,\n  author = {Duplicate, Key},");
    expect(byKey(parseBibtex(written).entries, "accents").fields.year).toBe("1999");
  });

  it("drops a deleted entry and appends a new one in the file's line endings", () => {
    const { entries, library } = opened("crlf_bom.bib");
    const [first, ...rest] = entries;
    const added: BibEntry = { key: "new2024", type: "article", fields: { title: "Added later", year: "2024", month: "3" }, authors: [{ family: "Şafak", given: "Nesibe" }], editors: [] };

    const written = writeBack(library, [...rest, added]);

    const reread = parseBibtex(written).entries;
    expect(reread.map((entry) => entry.key)).toEqual([...rest.map((entry) => entry.key), "new2024"]);
    expect(written.startsWith("﻿")).toBe(true);
    expect(written).not.toMatch(/[^\r]\n/);
    expect(written).toContain("month = mar");
    expect(written).not.toContain(`{${first.key},`);
  });

  it("does not write inherited crossref fields into the child when it is edited", () => {
    const { entries, library } = opened("handwritten.bib");
    const child = byKey(entries, "child");
    const edited = entries.map((entry) => (entry === child ? { ...entry, fields: { ...entry.fields, pages: "1--12" } } : entry));

    const written = writeBack(library, edited);

    const childText = written.slice(written.indexOf("@inproceedings{child"), written.indexOf("@proceedings{parent"));
    expect(child.fields).toMatchObject({ booktitle: "Proceedings of the Parent Conference", publisher: "Springer", year: "2005" });
    expect(childText).not.toContain("publisher");
    expect(childText).toContain("crossref = {parent}");
  });
});

describe("BibTeX reading", () => {
  it("recovers the entries after an unbalanced quote", () => {
    const { entries, skipped } = opened("malformed_quote.bib");

    expect(entries.map((entry) => entry.key)).toEqual(["ok1", "ok2", "ok3"]);
    expect(skipped).toBe(1);
  });

  it("turns math, Greek letters and super- and subscripts into text", () => {
    const entry = byKey(opened("handwritten.bib").entries, "mathcase");

    expect(entry.fields.title).toBe("The DNA of β-catenin and α-helices with E=mc² in NASA TeX data");
  });

  it("reads \\url verbatim and keeps the label of \\href", () => {
    const entry = byKey(opened("handwritten.bib").entries, "latexcmds");

    expect(entry.fields.howpublished).toBe("https://www.who.int/data/~stats?x=1&y=2_3");
    expect(entry.fields.note).toBe("Accessed 2024-01-10. See this page");
  });

  it("inherits from crossref and xdata parents and hides xdata blocks", () => {
    const { entries } = opened("handwritten.bib");

    expect(byKey(entries, "usesxdata").fields).toMatchObject({ publisher: "Springer", location: "Cham" });
    expect(entries.some((entry) => entry.key === "pubinfo")).toBe(false);
  });

  it("follows BibTeX for comment lines, repeated fields and commented-out entries", () => {
    const { entries } = opened("handwritten.bib");

    expect(byKey(entries, "commentInside").fields.year).toBe("2002");
    expect(byKey(entries, "repeatedfield").fields.title).toBe("First title");
    expect(entries.some((entry) => entry.key === "commentedOut")).toBe(false);
  });

  it("reads a Zotero thesis type as a doctoral or master's thesis", () => {
    const entries = parseBibtex("@thesis{t1, title = {A}, type = {phdthesis}, school = {METU}}\n@thesis{t2, title = {B}, type = {mathesis}}").entries;

    expect(entries.map((entry) => entry.type)).toEqual(["phdthesis", "mastersthesis"]);
    expect(entries[0].fields.type).toBeUndefined();
  });

  it("counts entries beyond the limit instead of dropping them silently", () => {
    const text = Array.from({ length: 10003 }, (_, index) => `@misc{k${index}, title = {T${index}}}`).join("\n");

    const result = parseBibtex(text);

    expect(result.entries).toHaveLength(10000);
    expect(result.truncated).toBe(3);
  });
});
