import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { SPACING_KEYS, SPACING_TYPES } from "./spacing";

export type PaintedFormat = { marks: Mark[]; block: Record<string, unknown> };

const PAINTED_MARKS = ["bold", "italic", "underline", "strike", "subscript", "superscript", "textStyle", "highlight", "code"];
const BLOCK_KEYS = ["textAlign", ...SPACING_KEYS];

function blockAttributes(node: ProseMirrorNode): Record<string, unknown> {
  return Object.fromEntries(BLOCK_KEYS.filter((key) => key in node.attrs).map((key) => [key, node.attrs[key]]));
}

export function captureFormat(state: EditorState): PaintedFormat {
  const { $from, empty } = state.selection;
  const marks = (empty ? (state.storedMarks ?? $from.marks()) : (state.doc.nodeAt($from.pos)?.marks ?? $from.marks())).filter((mark) => PAINTED_MARKS.includes(mark.type.name));
  return { marks, block: blockAttributes($from.parent) };
}

export function applyFormat(tr: Transaction, format: PaintedFormat): Transaction {
  const { from, to } = tr.selection;
  if (from === to) return tr;
  for (const name of PAINTED_MARKS) {
    const type = tr.doc.type.schema.marks[name];
    if (type) tr.removeMark(from, to, type);
  }
  for (const mark of format.marks) tr.addMark(from, to, mark);
  tr.doc.nodesBetween(from, to, (node, position) => {
    if (!SPACING_TYPES.includes(node.type.name)) return true;
    const attributes = Object.fromEntries(Object.entries(format.block).filter(([key]) => key in node.attrs));
    tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes });
    return false;
  });
  return tr;
}

export type TextCount = { words: number; characters: number };

export function countText(doc: ProseMirrorNode, from: number, to: number, language: string): TextCount {
  const text = doc.textBetween(from, to, "\n", " ");
  let words = 0;
  for (const piece of new Intl.Segmenter(language || undefined, { granularity: "word" }).segment(text)) if (piece.isWordLike) words += 1;
  return { words, characters: [...text.replace(/\n/g, "")].length };
}
