import { describe, expect, it } from "vitest";
import { PdfActionType, PdfAnnotationSubtype } from "@embedpdf/models";
import { internalLinkOf, linkUriOf } from "./annotationLink";

type LinkObject = Parameters<typeof linkUriOf>[0];

const linkWith = (target: unknown) =>
  ({ type: PdfAnnotationSubtype.LINK, target } as unknown as LinkObject);

describe("linkUriOf", () => {
  it("returns the uri of a URI action link", () => {
    expect(linkUriOf(linkWith({ type: "action", action: { type: PdfActionType.URI, uri: "https://example.com" } }))).toBe("https://example.com");
  });

  it("ignores a link whose action is not a uri", () => {
    expect(linkUriOf(linkWith({ type: "action", action: { type: PdfActionType.Goto, destination: {} } }))).toBeNull();
  });

  it("ignores a destination target", () => {
    expect(linkUriOf(linkWith({ type: "destination", destination: {} }))).toBeNull();
  });

  it("ignores a link without a target", () => {
    expect(linkUriOf(linkWith(undefined))).toBeNull();
  });

  it("ignores annotations that are not links", () => {
    expect(linkUriOf({ type: PdfAnnotationSubtype.SQUARE } as unknown as LinkObject)).toBeNull();
  });
});

describe("internalLinkOf", () => {
  it("finds the page of a destination link and of a go-to action", () => {
    expect(internalLinkOf(linkWith({ type: "destination", destination: { pageIndex: 5 } }))?.pageIndex).toBe(5);
    expect(internalLinkOf(linkWith({ type: "action", action: { type: PdfActionType.Goto, destination: { pageIndex: 2 } } }))?.pageIndex).toBe(2);
  });

  it("leaves web links and remote files to other handlers", () => {
    expect(internalLinkOf(linkWith({ type: "action", action: { type: PdfActionType.URI, uri: "https://example.com" } }))).toBeNull();
    expect(internalLinkOf(linkWith({ type: "action", action: { type: PdfActionType.RemoteGoto, destination: { pageIndex: 1 } } }))).toBeNull();
  });

  it("ignores links without targets and other annotations", () => {
    expect(internalLinkOf(linkWith(undefined))).toBeNull();
    expect(internalLinkOf({ type: PdfAnnotationSubtype.SQUARE } as unknown as LinkObject)).toBeNull();
  });
});
