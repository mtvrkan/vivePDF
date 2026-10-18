import type { Locale } from "..";
import { homeEn } from "./en";
import { homeTr, type HomeCopy } from "./tr";

export const HOME: Record<Locale, HomeCopy> = { tr: homeTr, en: homeEn };
export type { HomeCopy };
