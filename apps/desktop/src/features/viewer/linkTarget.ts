import { PdfZoomMode, type PdfAnnotationObject, type PdfDestinationObject, type PdfLinkTarget, type Rect, type Size } from "@embedpdf/models";
import { internalLinkOf, linkUriOf } from "./annotationLink";

export const PREVIEW_WIDTH_PX = 360;
export const PREVIEW_HEIGHT_PX = 200;
const PREVIEW_LEAD_PT = 14;
const MATCH_TOLERANCE_PT = 1.5;

export type HoveredLink = { kind: "page"; pageIndex: number; target: PdfLinkTarget } | { kind: "uri"; uri: string };

export function linkAtOrigin(objects: readonly PdfAnnotationObject[], x: number, y: number): HoveredLink | null {
  let best: { link: HoveredLink; distance: number } | null = null;
  for (const object of objects) {
    const distance = Math.max(Math.abs(object.rect.origin.x - x), Math.abs(object.rect.origin.y - y));
    if (distance > MATCH_TOLERANCE_PT || (best && best.distance <= distance)) continue;
    const internal = internalLinkOf(object);
    const uri = internal ? null : linkUriOf(object);
    const link: HoveredLink | null = internal ? { kind: "page", pageIndex: internal.pageIndex, target: internal.target } : uri ? { kind: "uri", uri } : null;
    if (link) best = { link, distance };
  }
  return best?.link ?? null;
}

export function destinationOf(target: PdfLinkTarget): PdfDestinationObject | null {
  if (target.type === "destination") return target.destination;
  return "destination" in target.action ? target.action.destination : null;
}

export function previewRect(destination: PdfDestinationObject | null, page: Size): Rect {
  const height = Math.min(page.height, (PREVIEW_HEIGHT_PX * page.width) / PREVIEW_WIDTH_PX);
  const zoom = destination?.zoom;
  const anchor = zoom && zoom.mode === PdfZoomMode.XYZ && Number.isFinite(zoom.params.y) ? page.height - zoom.params.y : null;
  const top = anchor === null ? 0 : Math.min(Math.max(anchor - PREVIEW_LEAD_PT, 0), Math.max(page.height - height, 0));
  return { origin: { x: 0, y: top }, size: { width: page.width, height } };
}
