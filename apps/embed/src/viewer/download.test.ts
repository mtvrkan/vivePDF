import { describe, expect, it } from "vitest";
import { downloadableUrl, savesDirectly } from "./download";

describe("downloadableUrl", () => {
  it("resolves web and blob addresses against the page", () => {
    const urls = [downloadableUrl("/files/a.pdf", "https://site.test/docs/"), downloadableUrl("blob:https://site.test/1234", "https://site.test/")];

    expect(urls).toEqual(["https://site.test/files/a.pdf", "blob:https://site.test/1234"]);
  });

  it("refuses script, data and file addresses", () => {
    const urls = ["javascript:alert(1)", "data:application/pdf;base64,AAAA", "file:///etc/passwd"].map((src) => downloadableUrl(src, "https://site.test/"));

    expect(urls).toEqual([null, null, null]);
  });

  it("returns nothing for an address that cannot be parsed", () => {
    const url = downloadableUrl("http://[bad", "https://site.test/");

    expect(url).toBeNull();
  });
});

describe("savesDirectly", () => {
  it("saves files from the page's own site and blobs with a plain link", () => {
    const direct = [savesDirectly("https://site.test/a.pdf", "https://site.test"), savesDirectly("blob:https://site.test/1234", "https://site.test")];

    expect(direct).toEqual([true, true]);
  });

  it("fetches files from another site first, since browsers ignore the download name there", () => {
    const direct = savesDirectly("https://cdn.test/a.pdf", "https://site.test");

    expect(direct).toBe(false);
  });

  it("does not save a blob made by another site as if it were the page's own", () => {
    const direct = savesDirectly("blob:https://other.test/1234", "https://site.test");

    expect(direct).toBe(false);
  });
});
