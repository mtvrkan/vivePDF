import type { BibEntry, BibName } from "@/types/studio";
import type { BibBlock, BibLibrary } from "./bibtex";
import { bibtexEntry, bibtexNames, bibtexValue } from "./sourceFormats";

function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function sameNames(first: BibName[], second: BibName[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function canonical(entry: BibEntry): string {
  const fields = Object.fromEntries(Object.entries(entry.fields).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([entry.key, entry.type, fields, entry.authors, entry.editors]);
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

type FieldStyle = { indent: string; width: number; before: string; after: string };

function fieldStyle(text: string, block: BibBlock): FieldStyle {
  const first = block.fields[0];
  if (!first) return { indent: "  ", width: 0, before: " ", after: " " };
  const prefix = text.slice(lineStart(text, first.start), first.start);
  const match = /^([^=\s]+)([ \t]*)=([ \t]*)/.exec(text.slice(first.start, first.end));
  const aligned = (match?.[2].length ?? 1) > 1;
  return { indent: /^\s*$/.test(prefix) ? prefix : "  ", width: aligned && match ? match[1].length + match[2].length : 0, before: aligned ? "" : (match?.[2] ?? " "), after: match?.[3] ?? " " };
}

function rewritten(library: BibLibrary, block: BibBlock, before: BibEntry, after: BibEntry, eol: string): string {
  const { text } = library;
  const inherited = new Set(library.inherited[before.key.toLowerCase()] ?? []);
  const style = fieldStyle(text, block);
  const indent = style.indent;
  const line = (name: string, value: string) => `${indent}${style.width ? name.padEnd(style.width) : name + style.before}=${style.after}${value}`;
  const keep = (start: number, end: number) => {
    const before = text.slice(lineStart(text, start), start);
    return `${/^\s*$/.test(before) ? before : indent}${text.slice(start, end)}`;
  };
  const type = after.type === before.type ? block.type : after.type;
  const lines: string[] = [];
  const written = new Set<string>();
  for (const field of block.fields) {
    if (written.has(field.name)) {
      lines.push(keep(field.start, field.end));
      continue;
    }
    written.add(field.name);
    const raw = keep(field.start, field.end);
    if (field.name === "author" || field.name === "editor") {
      const names = field.name === "author" ? after.authors : after.editors;
      const old = field.name === "author" ? before.authors : before.editors;
      if (sameNames(names, old)) lines.push(raw);
      else if (names.length > 0) lines.push(line(field.name, `{${bibtexNames(names)}}`));
      continue;
    }
    if (!(field.name in before.fields)) {
      lines.push(raw);
      continue;
    }
    const value = after.fields[field.name];
    if (value === before.fields[field.name]) lines.push(raw);
    else if (value) lines.push(line(field.name, bibtexValue(field.name, value)));
  }
  for (const role of ["author", "editor"] as const) {
    const names = role === "author" ? after.authors : after.editors;
    const old = role === "author" ? before.authors : before.editors;
    if (written.has(role) || names.length === 0 || (inherited.has(role) && sameNames(names, old))) continue;
    lines.push(line(role, `{${bibtexNames(names)}}`));
  }
  for (const [name, value] of Object.entries(after.fields)) {
    if (written.has(name) || !value || !/^[a-z][a-z0-9_\-:.+/]*$/.test(name)) continue;
    if (inherited.has(name) && value === before.fields[name]) continue;
    lines.push(line(name, bibtexValue(name, value)));
  }
  const last = block.fields[block.fields.length - 1];
  const tail = last ? text.slice(last.end, block.end).replace(/^,?/, (comma) => (comma && lines.length > 0 ? "," : "")) : `${eol}}`;
  const head = `${text.slice(block.start, block.start + 1)}${type}${text.slice(block.start + 1 + block.type.length, block.header).replace(before.key, after.key)}`;
  return `${head}${lines.length > 0 ? `,${eol}` : ""}${lines.join(`,${eol}`)}${tail}`;
}

export function writeBack(library: BibLibrary, sources: BibEntry[]): string {
  const { text } = library;
  const eol = lineEnding(text);
  const current = new Map(sources.map((entry) => [entry.key.toLowerCase(), entry]));
  const original = new Set(library.snapshot.map((entry) => entry.key.toLowerCase()));
  let out = "";
  let cursor = 0;
  for (const block of library.blocks) {
    const before = library.snapshot[block.entry];
    const after = current.get(before.key.toLowerCase());
    out += text.slice(cursor, block.start);
    cursor = block.end;
    if (!after) {
      out = out.replace(/(\r?\n)[ \t]*$/, "$1");
      if (text.startsWith(eol, cursor)) cursor += eol.length;
      continue;
    }
    out += canonical(after) === canonical(before) ? text.slice(block.start, block.end) : rewritten(library, block, before, after, eol);
  }
  out += text.slice(cursor);
  const added = sources.filter((entry) => !original.has(entry.key.toLowerCase()));
  if (added.length === 0) return out;
  const separator = out.length === 0 ? "" : out.endsWith(eol + eol) ? "" : out.endsWith(eol) ? eol : eol + eol;
  return `${out}${separator}${added.map((entry) => bibtexEntry(entry).replace(/\n/g, eol)).join(eol + eol)}${eol}`;
}
