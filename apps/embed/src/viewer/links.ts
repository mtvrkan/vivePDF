import { PdfActionType, PdfAnnotationSubtype, type PdfAnnotationObject, type Rect } from "@embedpdf/models";

export type PageLink = { kind: "page"; pageIndex: number; rect: Rect } | { kind: "url"; href: string; rect: Rect };

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeExternalUrl(uri: string, base: string): string | null {
  try {
    const url = new URL(uri.trim(), base);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function pageLinks(annotations: PdfAnnotationObject[], base: string): PageLink[] {
  const links: PageLink[] = [];
  for (const annotation of annotations) {
    if (annotation.type !== PdfAnnotationSubtype.LINK || !annotation.target) continue;
    const { target, rect } = annotation;
    if (target.type === "destination") links.push({ kind: "page", pageIndex: target.destination.pageIndex, rect });
    else if (target.action.type === PdfActionType.Goto) links.push({ kind: "page", pageIndex: target.action.destination.pageIndex, rect });
    else if (target.action.type === PdfActionType.URI) {
      const href = safeExternalUrl(target.action.uri, base);
      if (href) links.push({ kind: "url", href, rect });
    }
  }
  return links;
}

export function linkHost(href: string): string {
  const url = new URL(href);
  return url.protocol === "mailto:" ? url.pathname : url.host + (url.pathname === "/" ? "" : url.pathname);
}
