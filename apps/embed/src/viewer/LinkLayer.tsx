import { useEffect, useState } from "preact/hooks";
import { useRegistry } from "@embedpdf/core/preact";
import type { PdfAnnotationObject } from "@embedpdf/models";
import { useScroll } from "@embedpdf/plugin-scroll/preact";
import { useT } from "./i18nContext";
import { linkHost, pageLinks, type PageLink } from "./links";

type LinkLayerProps = { documentId: string; pageIndex: number; sourceUrl: string };

export function LinkLayer({ documentId, pageIndex, sourceUrl }: LinkLayerProps) {
  const t = useT();
  const { registry, documents } = useRegistry();
  const documentState = documents[documentId];
  const pdfDocument = documentState?.document ?? null;
  const scale = documentState?.scale ?? 1;
  const { provides: scroll } = useScroll(documentId);
  const [links, setLinks] = useState<PageLink[]>([]);

  useEffect(() => {
    const page = pdfDocument?.pages[pageIndex];
    if (!registry || !pdfDocument || !page) return;
    let cancelled = false;
    const task = registry.getEngine().getPageAnnotations(pdfDocument, page);
    task.wait(
      (annotations: PdfAnnotationObject[]) => {
        if (!cancelled) setLinks(pageLinks(annotations, sourceUrl));
      },
      () => {
        if (!cancelled) setLinks([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [registry, pdfDocument, pageIndex, sourceUrl]);

  if (links.length === 0) return null;
  return (
    <div class="vp-links">
      {links.map((link, index) => {
        const style = { left: link.rect.origin.x * scale, top: link.rect.origin.y * scale, width: link.rect.size.width * scale, height: link.rect.size.height * scale };
        if (link.kind === "page") {
          const label = t("linkToPage", { page: link.pageIndex + 1 });
          return (
            <button key={index} type="button" class="vp-link" style={style} aria-label={label} title={label} onClick={() => scroll?.scrollToPage({ pageNumber: link.pageIndex + 1, behavior: "instant" })} />
          );
        }
        const label = t("linkTo", { target: linkHost(link.href) });
        return <a key={index} class="vp-link" style={style} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={label} title={link.href} />;
      })}
    </div>
  );
}
