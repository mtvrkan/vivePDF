import { describe, expect, it } from "vitest";
import { PdfActionType, PdfAnnotationSubtype, PdfZoomMode, type PdfAnnotationObject } from "@embedpdf/models";
import { linkHost, pageLinks, safeExternalUrl } from "./links";

const BASE = "https://example.com/docs/report.pdf";

describe("safeExternalUrl", () => {
  it("keeps web and mail links", () => {
    const urls = [safeExternalUrl("https://vivepdf.com/a?b=1", BASE), safeExternalUrl("mailto:info@example.com", BASE)];

    expect(urls).toEqual(["https://vivepdf.com/a?b=1", "mailto:info@example.com"]);
  });

  it("resolves relative links against the document address", () => {
    const url = safeExternalUrl("  appendix.html ", BASE);

    expect(url).toBe("https://example.com/docs/appendix.html");
  });

  it("drops script, file and data links and broken input", () => {
    const urls = ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "file:///etc/hosts", "data:text/html,x", "http://[bad"].map((uri) => safeExternalUrl(uri, BASE));

    expect(urls).toEqual([null, null, null, null, null]);
  });
});

describe("pageLinks", () => {
  const rect = { origin: { x: 10, y: 20 }, size: { width: 100, height: 12 } };
  const link = (target: unknown) => ({ id: "a", pageIndex: 0, type: PdfAnnotationSubtype.LINK, rect, target }) as unknown as PdfAnnotationObject;

  it("keeps page jumps and safe web links in order", () => {
    const links = pageLinks(
      [
        link({ type: "destination", destination: { pageIndex: 2, zoom: { mode: PdfZoomMode.FitPage }, view: [] } }),
        link({ type: "action", action: { type: PdfActionType.URI, uri: "https://vivepdf.com/" } }),
      ],
      BASE,
    );

    expect(links).toEqual([
      { kind: "page", pageIndex: 2, rect },
      { kind: "url", href: "https://vivepdf.com/", rect },
    ]);
  });

  it("drops script links, links without a target and other annotations", () => {
    const links = pageLinks(
      [
        link({ type: "action", action: { type: PdfActionType.URI, uri: "javascript:alert(1)" } }),
        link(undefined),
        { ...link(undefined), type: PdfAnnotationSubtype.HIGHLIGHT } as unknown as PdfAnnotationObject,
      ],
      BASE,
    );

    expect(links).toEqual([]);
  });
});

describe("linkHost", () => {
  it("shows the site and path or the mail address", () => {
    const hosts = [linkHost("https://vivepdf.com/"), linkHost("https://example.com/docs/a.html"), linkHost("mailto:info@example.com")];

    expect(hosts).toEqual(["vivepdf.com", "example.com/docs/a.html", "info@example.com"]);
  });
});
