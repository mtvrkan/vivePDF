import { getCollection, type CollectionEntry } from "astro:content";
import { docPath, type Alternates, type Locale } from "../i18n";
import { DOCS, docByKey, type DocEntry } from "./structure";

export type DocProps = { entry: CollectionEntry<"docs">; doc: DocEntry };

export function entryLocale(entry: CollectionEntry<"docs">): Locale {
  return entry.id.split("/")[0] as Locale;
}

export function docAlternates(doc: DocEntry): Alternates {
  return { tr: docPath("tr", doc.slug.tr), en: docPath("en", doc.slug.en) };
}

export async function docStaticPaths(locale: Locale) {
  const entries = (await getCollection("docs")).filter((e) => entryLocale(e) === locale);
  return entries.map((entry) => {
    const doc = docByKey(entry.data.key);
    const file = entry.id.split("/")[1];
    if (file !== doc.slug[locale]) throw new Error(`${entry.id} should be named ${doc.slug[locale]}.mdx`);
    return { params: { slug: doc.slug[locale] }, props: { entry, doc } satisfies DocProps };
  });
}

export function neighbours(doc: DocEntry): { prev?: DocEntry; next?: DocEntry } {
  const i = DOCS.indexOf(doc);
  return { prev: DOCS[i - 1], next: DOCS[i + 1] };
}

export async function docTitles(locale: Locale): Promise<Map<string, { title: string; description: string }>> {
  const entries = (await getCollection("docs")).filter((e) => entryLocale(e) === locale);
  return new Map(entries.map((e) => [e.data.key, { title: e.data.title, description: e.data.description }]));
}
