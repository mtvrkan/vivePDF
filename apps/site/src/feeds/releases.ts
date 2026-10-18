import appData from "../data/app-data.json";
import { absoluteUrl, docPath, type Locale } from "../i18n";
import { HOME } from "../i18n/home";
import { UI } from "../i18n/ui";
import { releaseId } from "../docs/extras";
import { docByKey } from "../docs/structure";
import { escapeXml } from "../seo/xml";

export function releaseNotesPath(locale: Locale): string {
  return docPath(locale, docByKey("releaseNotes").slug[locale]);
}

export function releaseFeedPath(locale: Locale): string {
  return releaseNotesPath(locale).replace(/\/$/, ".xml");
}

function rfc822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

export function releaseFeed(locale: Locale): string {
  const copy = UI[locale].docs.releases;
  const dates = new Map(HOME[locale].download.releases.map((r) => [r.v, r.date]));
  const page = absoluteUrl(releaseNotesPath(locale));
  const items = appData.releases.map((release) => {
    const link = `${page}#${releaseId(release.version)}`;
    const date = dates.get(release.version);
    const list = `<ul>${release.items.map((item) => `<li>${escapeXml(item[locale])}</li>`).join("")}</ul>`;
    return [
      "<item>",
      `<title>vivePDF ${release.version}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
      date ? `<pubDate>${rfc822(date)}</pubDate>` : "",
      `<description>${escapeXml(list)}</description>`,
      "</item>",
    ].join("");
  });
  const newest = appData.releases.map((r) => dates.get(r.version)).find(Boolean);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    `<title>${escapeXml(copy.feedTitle)}</title>`,
    `<link>${escapeXml(page)}</link>`,
    `<description>${escapeXml(copy.feedDescription)}</description>`,
    `<language>${locale}</language>`,
    newest ? `<lastBuildDate>${rfc822(newest)}</lastBuildDate>` : "",
    `<atom:link href="${escapeXml(absoluteUrl(releaseFeedPath(locale)))}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "</channel></rss>",
    "",
  ].join("\n");
}
