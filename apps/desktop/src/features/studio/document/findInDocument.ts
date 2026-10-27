import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findInText, type FindOptions } from "../design/findReplace";
import { DELETION } from "./trackChanges";

export type DocumentMatch = { from: number; to: number };
export type FindQuery = { query: string; options: FindOptions; current: number };
type FindState = FindQuery & { matches: DocumentMatch[]; decorations: DecorationSet };

const OBJECT = "￼";
const IDLE: FindQuery = { query: "", options: { matchCase: false, wholeWord: false, language: "" }, current: -1 };

export const findKey = new PluginKey<FindState>("documentFind");

export function documentMatches(doc: ProseMirrorNode, query: string, options: FindOptions): DocumentMatch[] {
  if (!query) return [];
  const found: DocumentMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = "";
    const offsets: number[] = [];
    node.forEach((child, offset) => {
      if (child.marks.some((mark) => mark.type.name === DELETION)) return;
      const start = position + 1 + offset;
      if (child.isText) {
        const value = child.text ?? "";
        text += value;
        for (let index = 0; index < value.length; index += 1) offsets.push(start + index);
      } else {
        text += OBJECT;
        offsets.push(start);
      }
    });
    for (const range of findInText(text, query, options)) {
      if (text.slice(range.start, range.end).includes(OBJECT)) continue;
      found.push({ from: offsets[range.start], to: offsets[range.end - 1] + 1 });
    }
    return false;
  });
  return found;
}

function decorate(doc: ProseMirrorNode, matches: DocumentMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === current ? "vp-find-match vp-find-current" : "vp-find-match" })),
  );
}

function build(doc: ProseMirrorNode, query: FindQuery): FindState {
  const matches = documentMatches(doc, query.query, query.options);
  const current = matches.length ? Math.min(query.current, matches.length - 1) : -1;
  return { ...query, current, matches, decorations: decorate(doc, matches, current) };
}

export function findState(state: EditorState): FindState | undefined {
  return findKey.getState(state);
}

export function setFind(tr: Transaction, query: FindQuery): Transaction {
  return tr.setMeta(findKey, query);
}

export function revealMatch(tr: Transaction, match: DocumentMatch): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}

export function replaceMatch(tr: Transaction, match: DocumentMatch, replacement: string): Transaction {
  const text = replacement.replace(/\r?\n|\r/g, " ");
  return text ? tr.insertText(text, match.from, match.to) : tr.delete(match.from, match.to);
}

export function replaceAllMatches(tr: Transaction, matches: DocumentMatch[], replacement: string): Transaction {
  for (const match of [...matches].sort((left, right) => right.from - left.from)) replaceMatch(tr, match, replacement);
  return tr;
}

export const DocumentFind = Extension.create({
  name: "documentFind",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: (_, state) => build(state.doc, IDLE),
          apply: (tr, value, _, state) => {
            const query = tr.getMeta(findKey) as FindQuery | undefined;
            if (query) return build(state.doc, query);
            if (!tr.docChanged) return value;
            return value.query ? build(state.doc, value) : value;
          },
        },
        props: { decorations: (state) => findKey.getState(state)?.decorations },
      }),
    ];
  },
});
