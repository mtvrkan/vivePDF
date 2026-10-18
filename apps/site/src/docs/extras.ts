import appData from "../data/app-data.json";
import type { Locale } from "../i18n";
import { headingId, type TocHeading } from "./headings";
import type { DocKey } from "./structure";

export type Faq = Array<{ q: string; a: string }>;

export const toolGroupId = (id: string) => `tools-${id}`;
export const shortcutGroupId = (id: string) => `keys-${id}`;
export const releaseId = (version: string) => `v${version.replace(/\./g, "-")}`;

export function extraHeadings(key: DocKey, locale: Locale, faq: Faq = []): TocHeading[] {
  if (key === "tools") return appData.tools.groups.map((g) => ({ depth: 2, slug: toolGroupId(g.id), text: g.label[locale] }));
  if (key === "shortcuts") return appData.shortcuts.groups.map((g) => ({ depth: 2, slug: shortcutGroupId(g.id), text: g.label[locale] }));
  if (key === "releaseNotes") return appData.releases.map((r) => ({ depth: 2, slug: releaseId(r.version), text: `vivePDF ${r.version}` }));
  if (key === "faq") return faq.map((f) => ({ depth: 2, slug: headingId(f.q, locale), text: f.q }));
  return [];
}
