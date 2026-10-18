import { homePath, type Alternates } from "../i18n";

export type SiteRoute = { alternates: Alternates; lastmod: string };

export function siteRoutes(): SiteRoute[] {
  return [{ alternates: { tr: homePath("tr"), en: homePath("en") }, lastmod: "2026-10-18" }];
}
