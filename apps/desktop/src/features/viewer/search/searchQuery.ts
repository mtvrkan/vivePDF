const MIN_QUERY_LENGTH = 2;
const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function effectiveSearchQuery(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= MIN_QUERY_LENGTH) return trimmed;
  return IDEOGRAPHIC.test(trimmed) ? trimmed : "";
}
