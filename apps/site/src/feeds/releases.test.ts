import { describe, expect, it } from "vitest";
import appData from "../data/app-data.json";
import { releaseFeed, releaseFeedPath } from "./releases";

describe("release feed", () => {
  it("lists every release with a link to its section and a date", () => {
    const feed = releaseFeed("en");

    expect(feed.match(/<item>/g)).toHaveLength(appData.releases.length);
    expect(feed).toContain("<link>https://vivepdf.com/en/docs/release-notes/#v0-3-0</link>");
    expect(feed).toContain("<pubDate>Thu, 15 Oct 2026 00:00:00 GMT</pubDate>");
  });

  it("sits next to the release notes page in each language", () => {
    expect(releaseFeedPath("tr")).toBe("/dokumantasyon/surum-notlari.xml");
    expect(releaseFeedPath("en")).toBe("/en/docs/release-notes.xml");
  });

  it("escapes markup in the notes so the feed stays valid XML", () => {
    const feed = releaseFeed("tr");

    expect(feed).not.toMatch(/<description><ul>/);
    expect(feed).toContain("&lt;ul&gt;&lt;li&gt;");
  });
});
