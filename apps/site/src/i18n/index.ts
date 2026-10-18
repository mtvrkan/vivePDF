import appData from "../data/app-data.json";

export const LOCALES = ["tr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "tr";

export const SITE_URL = "https://vivepdf.com";
export const REPO_URL = "https://github.com/mtvrkan/vivePDF";
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const APP_VERSION = appData.version;
export const APP_RELEASE_DATE = "2026-10-15";

export const OG_LOCALE: Record<Locale, string> = { tr: "tr_TR", en: "en_US" };
export const LOCALE_NAME: Record<Locale, string> = { tr: "Türkçe", en: "English" };

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function homePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/" : `/${locale}/`;
}

export function docsIndexPath(locale: Locale): string {
  return locale === "tr" ? "/dokumantasyon/" : "/en/docs/";
}

export function docPath(locale: Locale, slug: string): string {
  return `${docsIndexPath(locale)}${slug}/`;
}

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href;
}

export type Alternates = Partial<Record<Locale, string>>;

export function hreflangLinks(alternates: Alternates): Array<{ hreflang: string; href: string }> {
  const links: Array<{ hreflang: string; href: string }> = LOCALES.filter((l) => alternates[l]).map((l) => ({
    hreflang: l,
    href: absoluteUrl(alternates[l] as string),
  }));
  const fallback = alternates[DEFAULT_LOCALE];
  if (fallback && links.length > 1) links.push({ hreflang: "x-default", href: absoluteUrl(fallback) });
  return links;
}
