import { describe, expect, it } from "vitest";
import { PdfActionType, PdfAnnotationSubtype, PdfZoomMode, type PdfAnnotationObject, type PdfDestinationObject } from "@embedpdf/models";
import { PREVIEW_HEIGHT_PX, PREVIEW_WIDTH_PX, destinationOf, linkAtOrigin, previewRect } from "./linkTarget";

const annotation = (x: number, y: number, target: unknown, type = PdfAnnotationSubtype.LINK) =>
  ({ type, target, rect: { origin: { x, y }, size: { width: 100, height: 12 } } }) as unknown as PdfAnnotationObject;

const pageLink = (x: number, y: number, pageIndex: number) => annotation(x, y, { type: "destination", destination: { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] } });

const page = { width: 600, height: 800 };
const stripHeight = (PREVIEW_HEIGHT_PX * page.width) / PREVIEW_WIDTH_PX;

describe("linkAtOrigin", () => {
  it("finds the link drawn at the hovered position", () => {
    const links = [pageLink(72, 112, 5), annotation(72, 300, { type: "action", action: { type: PdfActionType.URI, uri: "https://doi.org/10.1000/1" } })];
    expect(linkAtOrigin(links, 72.4, 111.6)).toMatchObject({ kind: "page", pageIndex: 5 });
    expect(linkAtOrigin(links, 72, 300)).toEqual({ kind: "uri", uri: "https://doi.org/10.1000/1" });
  });

  it("prefers the closest of overlapping links", () => {
    expect(linkAtOrigin([pageLink(72, 112, 1), pageLink(72.9, 112, 2)], 72.8, 112)).toMatchObject({ pageIndex: 2 });
  });

  it("ignores other annotations, links without a target and far positions", () => {
    expect(linkAtOrigin([annotation(72, 112, undefined, PdfAnnotationSubtype.SQUARE), annotation(72, 112, undefined)], 72, 112)).toBeNull();
    expect(linkAtOrigin([pageLink(72, 112, 5)], 80, 112)).toBeNull();
    expect(linkAtOrigin([], 0, 0)).toBeNull();
  });
});

describe("previewRect", () => {
  const xyz = (y: number): PdfDestinationObject => ({ pageIndex: 0, zoom: { mode: PdfZoomMode.XYZ, params: { x: 0, y, zoom: 0 } }, view: [] });

  it("starts the strip just above the destination point, measured from the bottom as PDF stores it", () => {
    expect(previewRect(xyz(500), page)).toEqual({ origin: { x: 0, y: 286 }, size: { width: 600, height: stripHeight } });
  });

  it("keeps the strip inside the page", () => {
    expect(previewRect(xyz(795), page).origin.y).toBe(0);
    expect(previewRect(xyz(10), page).origin.y).toBe(800 - stripHeight);
    expect(previewRect(xyz(100), { width: 600, height: 200 })).toEqual({ origin: { x: 0, y: 0 }, size: { width: 600, height: 200 } });
  });

  it("shows the top of the page for destinations without a point", () => {
    expect(previewRect({ pageIndex: 0, zoom: { mode: PdfZoomMode.FitPage }, view: [] }, page).origin.y).toBe(0);
    expect(previewRect(null, page).origin.y).toBe(0);
  });
});

describe("destinationOf", () => {
  it("reads destinations and go-to actions", () => {
    const destination = { pageIndex: 3, zoom: { mode: PdfZoomMode.FitPage }, view: [] } as PdfDestinationObject;
    expect(destinationOf({ type: "destination", destination })).toBe(destination);
    expect(destinationOf({ type: "action", action: { type: PdfActionType.Goto, destination } })).toBe(destination);
    expect(destinationOf({ type: "action", action: { type: PdfActionType.URI, uri: "https://example.com" } })).toBeNull();
  });
});
