import { describe, expect, it } from "vitest";
import appData from "../data/app-data.json";
import { LOCALES } from "../i18n";
import { DOCS, docByKey } from "../docs/structure";
import { docMarkdown, docMarkdownPath, llmsFull, llmsIndex, mdxToMarkdown, type DocSource } from "./markdown";

const source = (key: DocSource["doc"]["key"], body = "Text.", faq: DocSource["faq"] = []): DocSource => ({
  doc: docByKey(key),
  title: key,
  description: `About ${key}.`,
  updated: new Date("2026-10-18T00:00:00Z"),
  faq,
  body,
});

const allSources = Object.fromEntries(LOCALES.map((l) => [l, DOCS.map((d) => source(d.key))])) as Record<(typeof LOCALES)[number], DocSource[]>;

describe("mdxToMarkdown", () => {
  it("drops the Steps wrapper and turns a Callout into a titled blockquote", () => {
    const md = mdxToMarkdown('<Steps>\n1. One\n2. Two\n</Steps>\n\n<Callout type="tip" title="Moving pages">\nCopy them.\n\nThen paste.\n</Callout>');

    expect(md).toBe("1. One\n2. Two\n\n> **Moving pages**\n>\n> Copy them.\n>\n> Then paste.");
  });

  it("writes key runs as inline code and makes site links absolute", () => {
    const md = mdxToMarkdown("Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> or <kbd>?</kbd>, see [Tools](/en/docs/tools/#merge).");

    expect(md).toBe("Press `Ctrl+Z` or `?`, see [Tools](https://vivepdf.com/en/docs/tools/#merge).");
  });

  it("leaves fenced code untouched", () => {
    const body = "```sh\n<Steps>\npnpm tauri build --config '{\"a\":1}' <kbd>x</kbd> [a](/b)\n```";

    expect(mdxToMarkdown(body)).toBe(body);
  });
});

describe("docMarkdown", () => {
  it("heads a page with its title, summary, address and date", () => {
    const md = docMarkdown(source("pages"), "en");

    expect(md.startsWith("# pages\n\n> About pages.\n\nURL: https://vivepdf.com/en/docs/pages/\nLast updated: 2026-10-18\n\nText.")).toBe(true);
  });

  it("adds every tool from the app data to the tools page", () => {
    const md = docMarkdown(source("tools"), "tr");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Araç |") && !l.startsWith("| --- |"));

    expect(rows).toHaveLength(appData.tools.items.length);
  });

  it("adds the release list and the questions of a page", () => {
    expect(docMarkdown(source("releaseNotes"), "en")).toContain("## vivePDF 0.3.0\n\nReleased: 2026-10-15 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.3.0)");
    expect(docMarkdown(source("faq", "Intro.", [{ q: "Is it free?", a: "Yes." }]), "en")).toContain("## Is it free?\n\nYes.");
  });
});

describe("llms.txt", () => {
  it("links the Markdown copy of every page in both languages", () => {
    const index = llmsIndex(allSources);

    for (const locale of LOCALES) for (const doc of DOCS) expect(index).toContain(`(https://vivepdf.com${docMarkdownPath(locale, doc.slug[locale])})`);
  });

  it("starts with the title and a one-line summary as the format expects", () => {
    expect(llmsIndex(allSources)).toMatch(/^# vivePDF\n\n> .+\n\n/);
  });

  it("puts the Markdown copy next to the page", () => {
    expect(docMarkdownPath("tr", "sayfalar")).toBe("/dokumantasyon/sayfalar.md");
    expect(docMarkdownPath("en", "pages")).toBe("/en/docs/pages.md");
  });

  it("joins every page of one language into the full file", () => {
    const full = llmsFull("en", allSources.en);

    expect(full.split("\n---\n")).toHaveLength(DOCS.length + 1);
  });
});
