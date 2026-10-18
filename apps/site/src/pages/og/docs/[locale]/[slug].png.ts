import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { docPath, SITE_URL } from "../../../../i18n";
import { UI } from "../../../../i18n/ui";
import { docByKey } from "../../../../docs/structure";
import { entryLocale } from "../../../../docs/pages";
import { cardPng, type Card } from "../../../../og/card";

export const getStaticPaths = (async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => {
    const locale = entryLocale(entry);
    const doc = docByKey(entry.data.key);
    const ui = UI[locale];
    const card: Card = {
      lang: locale,
      eyebrow: `${ui.docs.title} · ${ui.docs.groups[doc.group]}`,
      title: entry.data.title,
      description: entry.data.description,
      address: `${new URL(SITE_URL).host}${docPath(locale, doc.slug[locale])}`.replace(/\/$/, ""),
    };
    return { params: { locale, slug: doc.slug[locale] }, props: { card } };
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => new Response(cardPng((props as { card: Card }).card), { headers: { "Content-Type": "image/png" } });
