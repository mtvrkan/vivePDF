import { PdfActionType, PdfAnnotationSubtype, type PdfAnnotationObject, type PdfLinkTarget } from "@embedpdf/models";

export function linkUriOf(object: PdfAnnotationObject): string | null {
  if (object.type !== PdfAnnotationSubtype.LINK) return null;
  const target = object.target;
  if (!target || target.type !== "action") return null;
  return target.action.type === PdfActionType.URI ? target.action.uri : null;
}

export function internalLinkOf(object: PdfAnnotationObject): { target: PdfLinkTarget; pageIndex: number } | null {
  if (object.type !== PdfAnnotationSubtype.LINK) return null;
  const target = object.target;
  if (!target) return null;
  if (target.type === "destination") return { target, pageIndex: target.destination.pageIndex };
  if (target.action.type === PdfActionType.Goto) return { target, pageIndex: target.action.destination.pageIndex };
  return null;
}
