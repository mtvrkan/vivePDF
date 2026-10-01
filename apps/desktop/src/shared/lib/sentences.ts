export const SENTENCE_MAX_CHARS = 400;

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "eg", "ie",
  "no", "st", "vol", "fig", "cf", "approx", "sn", "sy", "dt", "op",
]);

export type Sentence = { text: string; start: number; end: number };

function capLength(sentences: string[], maxChars: number): string[] {
  const result: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      result.push(sentence);
      continue;
    }
    const words = sentence.split(" ");
    let chunk = "";
    for (const word of words) {
      const candidate = chunk ? `${chunk} ${word}` : word;
      if (candidate.length > maxChars && chunk) {
        result.push(chunk);
        chunk = word;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) result.push(chunk);
  }
  return result;
}

export function splitSentences(text: string, maxChars: number = SENTENCE_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const ender = /[.!?…]+/g;
  const sentences: string[] = [];
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = ender.exec(normalized)) !== null) {
    const end = match.index + match[0].length;
    const wordMatch = /([A-Za-zÇĞİÖŞÜçğıöşü]+)$/.exec(normalized.slice(start, match.index));
    const word = wordMatch ? wordMatch[1].toLowerCase() : "";
    const nextChar = normalized.slice(end, end + 1);
    if (ABBREVIATIONS.has(word) && nextChar !== "") continue;
    if (nextChar && !/\s/.test(nextChar) && !['"', "'", ")", "”"].includes(nextChar)) continue;
    const sentence = normalized.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);
  return capLength(sentences, maxChars);
}

export function locateSentences(text: string, sentences: string[]): Sentence[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  let cursor = 0;
  return sentences.map((sentence) => {
    let offset = normalized.indexOf(sentence, cursor);
    if (offset === -1) offset = cursor;
    const start = offset;
    const end = offset + sentence.length;
    cursor = end;
    return { text: sentence, start, end };
  });
}
