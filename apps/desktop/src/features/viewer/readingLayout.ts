import { locateSentences, splitSentences, type Sentence } from "@/shared/lib/sentences";

export type ReadingPiece = { text: string; start: number; end: number; sentenceIndex: number };
export type ReadingParagraph = { pieces: ReadingPiece[] };
export type TextRange = { start: number; end: number };
export type MeasuredHeight = { layoutKey: string; height: number };

const CHARS_PER_LINE_ESTIMATE = 90;
const LINE_HEIGHT = 1.65;
const SECTION_CHROME = 56;

export function normalizePageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function pageSentences(text: string): Sentence[] {
  const normalized = normalizePageText(text);
  return locateSentences(normalized, splitSentences(normalized));
}

export function sentenceAt(sentences: Sentence[], offset: number): number {
  let low = 0;
  let high = sentences.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < sentences[middle].end) high = middle;
    else low = middle + 1;
  }
  return low < sentences.length ? low : Math.max(0, sentences.length - 1);
}

function paragraphPieces(cleaned: string, normalized: string, cursor: number, sentences: Sentence[]): { pieces: ReadingPiece[]; cursor: number } {
  const pieces: ReadingPiece[] = [];
  let position = cursor;
  let current: ReadingPiece | null = null;
  for (const char of cleaned) {
    let offset = position;
    if (/\s/.test(char)) {
      if (normalized[position] === " ") offset = position;
    } else {
      while (position < normalized.length && normalized[position] === " ") position += 1;
      offset = position;
      position += char.length;
    }
    const sentenceIndex: number = /\s/.test(char) && current ? current.sentenceIndex : sentenceAt(sentences, offset);
    if (!current || current.sentenceIndex !== sentenceIndex) {
      current = { text: "", start: offset, end: offset, sentenceIndex };
      pieces.push(current);
    }
    current.text += char;
    current.end = Math.max(current.end, /\s/.test(char) ? offset : position);
  }
  return { pieces, cursor: position };
}

export function readingParagraphs(text: string, sentences: Sentence[] = pageSentences(text)): ReadingParagraph[] {
  if (!text) return [];
  const normalized = normalizePageText(text);
  let cursor = 0;
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/(?<![.:;!?])\n(?=[^\s•])/g, " "))
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((cleaned) => {
      const built = paragraphPieces(cleaned.trim(), normalized, cursor, sentences);
      cursor = built.cursor;
      return { pieces: built.pieces };
    });
}

export function overlapsRange(piece: TextRange, active: TextRange): boolean {
  return piece.start < active.end && active.start < piece.end;
}

export function estimateSectionHeight(text: string, fontSize: number): number {
  const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE_ESTIMATE));
  return lines * fontSize * LINE_HEIGHT + SECTION_CHROME;
}

export function placeholderHeight(measured: MeasuredHeight | null, layoutKey: string, text: string, fontSize: number): number {
  return measured && measured.layoutKey === layoutKey && measured.height > 0 ? measured.height : estimateSectionHeight(text, fontSize);
}
