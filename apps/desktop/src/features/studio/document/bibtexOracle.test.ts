import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@retorquere/bibtex-parser";
import { describe, expect, it } from "vitest";
import type { BibName } from "@/types/studio";
import { parseBibtex } from "./bibtex";

const CORPUS = join(__dirname, "testdata", "bib");
const FILES = readdirSync(CORPUS).filter((name) => name.endsWith(".bib") && !name.startsWith("malformed_"));
const COMPARED_FIELDS = ["title", "journal", "booktitle", "year", "volume", "number", "pages", "doi", "publisher"];
const THESIS_TYPES: Record<string, string> = { phdthesis: "thesis", mastersthesis: "thesis" };

type OracleName = { lastName?: string; firstName?: string; prefix?: string; suffix?: string; name?: string };

function oracleText(value: string): string {
  return value.replace(/ı\u0301/g, "í").replace(/\s+/g, " ").normalize("NFC");
}

function ourName(name: BibName): string {
  if (name.others) return "others";
  if (name.literal) return name.family;
  return [name.family, name.given, name.suffix ?? ""].join("|");
}

function oracleName(name: OracleName): string {
  if (name.name) return oracleText(name.name);
  if (name.lastName === "others" && !name.firstName) return "others";
  return oracleText([[name.prefix, name.lastName].filter(Boolean).join(" "), name.firstName ?? "", name.suffix ?? ""].join("|"));
}

function plain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return oracleText(value);
}

describe.each(FILES)("BibTeX reading of %s matches @retorquere/bibtex-parser", (name) => {
  const text = readFileSync(join(CORPUS, name), "utf8");
  const ours = parseBibtex(text).entries;
  const theirs = parse(text, { sentenceCase: false, applyCrossRef: true }).entries;

  it("finds every entry the oracle finds", () => {
    const ourKeys = new Set(ours.map((entry) => entry.key.toLowerCase()));
    const missing = theirs.filter((entry) => !ourKeys.has(entry.key.toLowerCase()) && entry.type !== "xdata");

    expect(missing.map((entry) => entry.key)).toEqual([]);
  });

  it("reads the same types, names and fields", () => {
    const differences: string[] = [];
    for (const entry of ours) {
      const other = theirs.find((candidate) => candidate.key === entry.key);
      if (!other) continue;
      if ((THESIS_TYPES[entry.type] ?? entry.type) !== (THESIS_TYPES[other.type] ?? other.type)) differences.push(`${entry.key} type`);
      const theirNames = ((other.fields.author as OracleName[] | undefined) ?? []).map(oracleName);
      const ourNames = entry.authors.map(ourName);
      if (JSON.stringify(ourNames) !== JSON.stringify(theirNames)) differences.push(`${entry.key} authors ${ourNames.join("; ")} ≠ ${theirNames.join("; ")}`);
      for (const field of COMPARED_FIELDS) {
        const expected = plain((other.fields as Record<string, unknown>)[field]);
        if (expected === undefined || /[<\\]/.test(expected)) continue;
        if (entry.fields[field] !== expected) differences.push(`${entry.key} ${field} ${entry.fields[field]} ≠ ${expected}`);
      }
    }

    expect(differences).toEqual([]);
  });
});
