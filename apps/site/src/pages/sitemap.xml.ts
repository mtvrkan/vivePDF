import type { APIRoute } from "astro";
import { absoluteUrl, hreflangLinks, LOCALES } from "../i18n";
import { siteRoutes } from "../seo/routes";
import { escapeXml } from "../seo/xml";

export const GET: APIRoute = async () => {
  const urls = (await siteRoutes()).flatMap((route) => {
    const links = hreflangLinks(route.alternates)
      .map((l) => `<xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${escapeXml(l.href)}"/>`)
      .join("");
    return LOCALES.filter((l) => route.alternates[l]).map(
      (l) => `<url><loc>${escapeXml(absoluteUrl(route.alternates[l] as string))}</loc><lastmod>${route.lastmod}</lastmod>${links}</url>`,
    );
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
