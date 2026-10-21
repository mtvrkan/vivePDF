import appData from "../data/app-data.json";
import {
  absoluteUrl,
  APP_RELEASE_DATE,
  APP_VERSION,
  docPath,
  docsIndexPath,
  homePath,
  ISSUES_URL,
  LATEST_RELEASE_URL,
  REPO_URL,
  type Locale,
} from "../i18n";
import { HOME } from "../i18n/home";
import { UI } from "../i18n/ui";
import { releaseFeedPath } from "../feeds/releases";
import type { Faq } from "../docs/extras";
import { DOC_GROUPS, type DocEntry } from "../docs/structure";

export type DocSource = { doc: DocEntry; title: string; description: string; updated: Date; faq: Faq; body: string };

export const LLMS_FULL_PATH: Record<Locale, string> = { tr: "/llms-full-tr.txt", en: "/llms-full.txt" };

export function docMarkdownPath(locale: Locale, slug: string): string {
  return docPath(locale, slug).replace(/\/$/, ".md");
}

const cell = (value: string) => value.replace(/\|/g, "\\|");
const keys = (text: string) => text.replace(/<kbd>[^<]*<\/kbd>(?:\+<kbd>[^<]*<\/kbd>)*/g, (run) => `\`${run.replace(/<\/?kbd>/g, "")}\``);
const siteLinks = (text: string) => text.replace(/\]\((\/[^)\s]*)\)/g, (_, path: string) => `](${absoluteUrl(path)})`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function mdxToMarkdown(body: string): string {
  const out: string[] = [];
  let fenced = false;
  let callout = false;
  for (const line of body.trim().split("\n")) {
    if (!fenced) {
      if (/^<\/?Steps>\s*$/.test(line)) continue;
      if (/^<Callout\b.*>\s*$/.test(line)) {
        const title = /title="([^"]*)"/.exec(line)?.[1];
        if (title) out.push(`> **${title}**`, ">");
        callout = true;
        continue;
      }
      if (/^<\/Callout>\s*$/.test(line)) {
        callout = false;
        continue;
      }
    }
    const fence = /^\s*(```|~~~)/.test(line);
    const text = fenced || fence ? line : siteLinks(keys(line));
    if (fence) fenced = !fenced;
    out.push(callout ? (text ? `> ${text}` : ">") : text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function table(head: string[], rows: string[][]): string {
  return [head, head.map(() => "---"), ...rows].map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
}

function extraMarkdown(source: DocSource, locale: Locale): string {
  const copy = UI[locale].docs;
  const key = source.doc.key;
  if (key === "tools") {
    return appData.tools.groups
      .map((g) => {
        const rows = appData.tools.items.filter((t) => t.group === g.id).map((t) => [t.label[locale], t.description[locale]]);
        return `## ${g.label[locale]}\n\n${table([copy.tools.tool, copy.tools.what], rows)}`;
      })
      .join("\n\n");
  }
  if (key === "shortcuts") {
    const gestures: Record<string, string> = appData.shortcuts.gestures[locale];
    const show = (combos: string[]) => combos.map((c) => `\`${c.replace(/\{(\w+)\}/g, (_, g: string) => gestures[g] ?? g)}\``).join(` ${copy.keys.or} `);
    return appData.shortcuts.groups
      .map((g) => {
        const rows = g.items.map((item) => [item.label[locale], show(item.win), show(item.mac)]);
        return `## ${g.label[locale]}\n\n${table([copy.keys.action, "Windows · Linux", "macOS"], rows)}`;
      })
      .join("\n\n");
  }
  if (key === "releaseNotes") {
    const dates = new Map(HOME[locale].download.releases.map((r) => [r.v, r.date]));
    return appData.releases
      .map((r) => {
        const date = dates.get(r.version);
        const meta = date ? `${copy.releases.released}: ${date} · [GitHub](${REPO_URL}/releases/tag/v${r.version})\n\n` : "";
        return `## vivePDF ${r.version}\n\n${meta}${r.items.map((item) => `- ${item[locale]}`).join("\n")}`;
      })
      .join("\n\n");
  }
  return source.faq.map((f) => `## ${f.q}\n\n${f.a}`).join("\n\n");
}

export function docMarkdown(source: DocSource, locale: Locale): string {
  const url = absoluteUrl(docPath(locale, source.doc.slug[locale]));
  return [
    `# ${source.title}`,
    `> ${source.description}`,
    `URL: ${url}\n${UI[locale].docs.updated}: ${isoDate(source.updated)}`,
    mdxToMarkdown(source.body),
    extraMarkdown(source, locale),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function llmsFull(locale: Locale, sources: DocSource[]): string {
  const copy = UI[locale].docs;
  const head = `# vivePDF · ${copy.title}\n\n> ${copy.description}\n\nURL: ${absoluteUrl(docsIndexPath(locale))}`;
  return `${[head, ...sources.map((s) => docMarkdown(s, locale))].join("\n\n---\n\n")}\n`;
}

const docLink = (source: DocSource, locale: Locale) =>
  `- [${source.title}](${absoluteUrl(docMarkdownPath(locale, source.doc.slug[locale]))}): ${source.description}`;

export function llmsIndex(sources: Record<Locale, DocSource[]>): string {
  const groups = DOC_GROUPS.flatMap((group) => {
    const items = sources.en.filter((s) => s.doc.group === group);
    return items.length ? [`## ${UI.en.docs.groups[group]}\n\n${items.map((s) => docLink(s, "en")).join("\n")}`] : [];
  });
  return `${[
    "# vivePDF",
    "> vivePDF is a free, open-source (AGPL-3.0) PDF editor for Windows and macOS that works fully offline. It views, edits, organises, converts, OCRs, signs and presents PDFs on the user's own computer, and the files never leave it.",
    [
      "Key facts:",
      "",
      "- Price: free. Every tool is included; there are no paid tiers, accounts or usage limits.",
      "- Privacy: no telemetry, no account. Documents, passwords and certificates stay on the computer. Only update checks, OCR language-pack downloads and turning a web page into a PDF go online, and offline mode stops all of them.",
      "- Platforms: Windows 10 and 11 (64-bit), and macOS 14 Sonoma or later on Apple silicon. On Linux it is built from source.",
      `- Tools: ${appData.tools.items.length} PDF tools in one app, including merge, split, compress, OCR, convert to and from Office formats, digital signatures (PAdES), redaction, form filling and comparison. A presenter view shows slides on one screen and notes on the other.`,
      "- Studio: a built-in design and document editor with templates, CVs and business cards.",
      "- Interface languages: Turkish, English, German, French, Spanish, Italian, Brazilian Portuguese and Arabic.",
      `- Latest version: ${APP_VERSION}, released ${APP_RELEASE_DATE}.`,
      `- Source code and downloads: ${REPO_URL}`,
      `- Website: English at ${absoluteUrl(homePath("en"))} (default) and Turkish at ${absoluteUrl(homePath("tr"))}. Every documentation page below is also available as plain Markdown.`,
    ].join("\n"),
    ...groups,
    `## Türkçe dokümantasyon\n\n${sources.tr.map((s) => docLink(s, "tr")).join("\n")}`,
    [
      "## Download and source",
      "",
      `- [Latest release](${LATEST_RELEASE_URL}): Windows installer and macOS disk image`,
      `- [Source code on GitHub](${REPO_URL}): the desktop app, the PDF engine and this website, under AGPL-3.0`,
      `- [Report a bug or ask a question](${ISSUES_URL})`,
    ].join("\n"),
    [
      "## Optional",
      "",
      `- [Full English documentation in one file](${absoluteUrl(LLMS_FULL_PATH.en)})`,
      `- [Full Turkish documentation in one file](${absoluteUrl(LLMS_FULL_PATH.tr)})`,
      `- [Release notes feed, English](${absoluteUrl(releaseFeedPath("en"))})`,
      `- [Release notes feed, Turkish](${absoluteUrl(releaseFeedPath("tr"))})`,
      `- [Sitemap](${absoluteUrl("/sitemap.xml")})`,
    ].join("\n"),
  ].join("\n\n")}\n`;
}
