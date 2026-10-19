import { getCollection } from "astro:content";
import type { Locale } from "../i18n";
import { entryLocale } from "../docs/pages";
import { DOCS } from "../docs/structure";
import type { DocSource } from "./markdown";

export async function docSources(locale: Locale): Promise<DocSource[]> {
  const entries = (await getCollection("docs")).filter((e) => entryLocale(e) === locale);
  return DOCS.flatMap((doc) => {
    const entry = entries.find((e) => e.data.key === doc.key);
    if (!entry) return [];
    const { title, description, updated, faq = [] } = entry.data;
    return [{ doc, title, description, updated, faq, body: entry.body ?? "" }];
  });
}
