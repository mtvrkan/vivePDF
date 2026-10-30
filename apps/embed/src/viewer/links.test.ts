import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./links";

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
