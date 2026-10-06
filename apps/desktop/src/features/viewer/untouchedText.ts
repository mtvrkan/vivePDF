import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";

export const ENGINE_TEXT_PLACEHOLDER = "Insert text";

export function isUntouchedText(object: PdfAnnotationObject | undefined, placeholders: string[]): boolean {
  if (!object || object.type !== PdfAnnotationSubtype.FREETEXT) return false;
  const contents = ("contents" in object ? (object.contents ?? "") : "").trim();
  return contents === "" || placeholders.includes(contents);
}

export function droppedUntouchedTexts(
  previous: string[],
  current: string[],
  byUid: Record<string, { object: PdfAnnotationObject }>,
  placeholders: string[],
): Array<{ pageIndex: number; id: string }> {
  const stillSelected = new Set(current);
  return previous
    .filter((uid) => !stillSelected.has(uid))
    .map((uid) => byUid[uid]?.object)
    .filter((object): object is PdfAnnotationObject => isUntouchedText(object, placeholders))
    .map((object) => ({ pageIndex: object.pageIndex, id: object.id }));
}
