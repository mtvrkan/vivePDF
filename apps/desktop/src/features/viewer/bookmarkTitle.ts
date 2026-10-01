export const BOOKMARK_TITLE_LIMIT = 120;

export function bookmarkTitleFrom(selectionText: string): string {
  const line =
    selectionText
      .split(/\r?\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find((part) => part.length > 0) ?? "";
  return line.length > BOOKMARK_TITLE_LIMIT ? `${line.slice(0, BOOKMARK_TITLE_LIMIT - 1).trimEnd()}…` : line;
}
