import type { Editor } from "@tiptap/react";
import type { BibEntry, BibName } from "@/types/studio";
import { isValidKey, MAX_FIELD_CHARS, parseNames } from "./bibtex";
import { CITATION, citationItems } from "./citationItems";
import { claimKey, keyBase } from "./sourceKeys";

export const EDITABLE_TYPES = ["article", "book", "incollection", "inproceedings", "phdthesis", "mastersthesis", "techreport", "online", "misc"];

export const EDITABLE_FIELDS = ["title", "year", "journal", "booktitle", "volume", "number", "pages", "publisher", "school", "institution", "address", "edition", "isbn", "howpublished", "urldate", "doi", "url", "note"];

const TYPE_FIELDS: Record<string, string[]> = {
  article: ["journal", "volume", "number", "pages"],
  book: ["publisher", "address", "edition", "isbn"],
  incollection: ["booktitle", "publisher", "address", "pages"],
  inproceedings: ["booktitle", "publisher", "address", "pages"],
  phdthesis: ["school", "address"],
  mastersthesis: ["school", "address"],
  techreport: ["institution", "number", "address"],
  online: ["urldate"],
  misc: ["howpublished", "publisher"],
};

export type SourceDraft = { type: string; key: string; authors: string; editors: string; fields: Record<string, string> };

export type KeyProblem = "invalid" | "taken";

export function namesText(names: BibName[]): string {
  return names.map((name) => (name.others ? "others" : name.literal ? `{${name.family}}` : name.given ? `${name.family}, ${name.given}` : name.family)).join("\n");
}

export function namesOf(text: string): BibName[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^(?:others|et al\.?)$/i.test(line) ? "others" : line));
  return lines.length > 0 ? parseNames(lines.join(" and ")) : [];
}

export function draftOf(entry: BibEntry | null): SourceDraft {
  if (!entry) return { type: "article", key: "", authors: "", editors: "", fields: {} };
  return { type: entry.type, key: entry.key, authors: namesText(entry.authors), editors: namesText(entry.editors), fields: { ...entry.fields } };
}

export function shownFields(type: string, fields: Record<string, string>): string[] {
  const wanted = ["year", ...(TYPE_FIELDS[type] ?? TYPE_FIELDS.misc), "doi", "url", "note"];
  const extra = EDITABLE_FIELDS.filter((name) => name !== "title" && fields[name] && !wanted.includes(name));
  return [...wanted, ...extra];
}

export function keyProblem(key: string, taken: Set<string>): KeyProblem | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (!isValidKey(trimmed)) return "invalid";
  return taken.has(trimmed.toLowerCase()) ? "taken" : null;
}

export function entryOfDraft(draft: SourceDraft, original: BibEntry | null, taken: Set<string>): BibEntry {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(draft.fields)) {
    const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
    if (text) fields[name] = text;
  }
  const authors = original && draft.authors === namesText(original.authors) ? original.authors : namesOf(draft.authors);
  const editors = original && draft.editors === namesText(original.editors) ? original.editors : namesOf(draft.editors);
  const key = claimKey(draft.key.trim(), keyBase(authors, fields.year ?? "", fields.title ?? ""), taken);
  return { key, type: draft.type, fields, authors, editors };
}

export function renameCitationKey(editor: Editor, from: string, to: string) {
  const old = from.toLowerCase();
  const { tr, doc } = editor.state;
  doc.descendants((node, position) => {
    if (node.type.name !== CITATION) return;
    const items = citationItems(node.attrs.items);
    if (!items.some((item) => item.key.toLowerCase() === old)) return;
    tr.setNodeMarkup(position, undefined, { ...node.attrs, items: items.map((item) => (item.key.toLowerCase() === old ? { ...item, key: to } : item)) });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
