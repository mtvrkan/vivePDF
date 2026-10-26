import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { LaidOut } from "./useDocumentLayout";

const TOP_TOLERANCE = 1;
const MATCHED_WORDS = 4;

export type PageLine = { page: number; y: number };

export type PageBreak = { page: number; block: number; words: string[] | null };

type Start = { index: number; page: number; top: number };

export function firstPage(layout: LaidOut): number | null {
  return starts(layout)[0]?.page ?? null;
}

function starts(layout: LaidOut): Start[] {
  const indexOf = new Map<string, number>();
  layout.blockIds.forEach((id, index) => {
    if (id) indexOf.set(id, index);
  });
  return layout.blockStarts
    .filter((block) => indexOf.has(block.id))
    .map((block) => ({ index: indexOf.get(block.id) as number, page: block.page, top: block.top }))
    .sort((left, right) => left.index - right.index);
}

export function pageBreaks(layout: LaidOut): PageBreak[] {
  const ordered = starts(layout);
  if (ordered.length === 0) return [];
  const first = ordered[0].page;
  const breaks: PageBreak[] = [];
  for (const start of layout.pageStarts) {
    if (start.page <= first) continue;
    const opening = ordered.find((block) => block.page === start.page);
    if (opening && opening.top <= start.top + TOP_TOLERANCE) {
      breaks.push({ page: start.page, block: opening.index, words: null });
      continue;
    }
    const containing = [...ordered].reverse().find((block) => block.page < start.page);
    if (containing) breaks.push({ page: start.page, block: containing.index, words: start.words });
  }
  return breaks;
}

function normalized(word: string): string {
  return word
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

type Token = { text: string; pos: number };

function tokens(doc: ProseMirrorNode, from: number, to: number): Token[] {
  const found: Token[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let index = 0; index < child.text.length; index += 1) {
        text += child.text[index];
        positions.push(pos + 1 + offset + index);
      }
    });
    for (const match of text.matchAll(/\S+/g)) found.push({ text: normalized(match[0]), pos: positions[match.index] });
    return false;
  });
  return found;
}

function matches(token: string, word: string): boolean {
  return token !== "" && word !== "" && (token === word || word.startsWith(token) || token.startsWith(word));
}

export function wordsPosition(doc: ProseMirrorNode, blockIndex: number, words: string[]): number | null {
  if (blockIndex < 0 || blockIndex >= doc.childCount) return null;
  let start = 0;
  for (let index = 0; index < blockIndex; index += 1) start += doc.child(index).nodeSize;
  const list = tokens(doc, start, start + doc.child(blockIndex).nodeSize);
  const wanted = words.map(normalized).filter((word) => word !== "");
  const shortest = Math.min(2, wanted.length);
  for (let length = Math.min(MATCHED_WORDS, wanted.length); length >= shortest && length > 0; length -= 1) {
    const at = list.findIndex((_, index) => wanted.slice(0, length).every((word, step) => list[index + step] && matches(list[index + step].text, word)));
    if (at >= 0) return list[at].pos;
  }
  return null;
}

export function currentPage(editor: Editor, laid: LaidOut | null, lines: PageLine[], paper: HTMLElement | null, zoom: number): number | null {
  if (!laid || !paper) return null;
  const first = firstPage(laid);
  if (first === null) return null;
  const caret = (editor.view.coordsAtPos(editor.state.selection.head).top - paper.getBoundingClientRect().top) / zoom;
  return lines.reduce((page, line) => (line.y <= caret ? Math.max(page, line.page) : page), first);
}
