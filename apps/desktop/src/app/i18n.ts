import i18n, { type TFunction } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/common.json";
import { DEFAULT_LOCALE, LOCALE_CODES, detectLocale, isLocale, localeDirection } from "@/app/locales";
import type { Locale } from "@/types";

export const LOCALE_STORAGE_KEY = "vivepdf.locale";

const catalogLoaders: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  tr: () => import("@/locales/tr/common.json"),
  en: () => import("@/locales/en/common.json"),
  de: () => import("@/locales/de/common.json"),
  fr: () => import("@/locales/fr/common.json"),
  es: () => import("@/locales/es/common.json"),
  it: () => import("@/locales/it/common.json"),
  "pt-BR": () => import("@/locales/pt-BR/common.json"),
  ru: () => import("@/locales/ru/common.json"),
  ar: () => import("@/locales/ar/common.json"),
  "zh-CN": () => import("@/locales/zh-CN/common.json"),
  ja: () => import("@/locales/ja/common.json"),
  ko: () => import("@/locales/ko/common.json"),
};

const loadedLocales = new Set<Locale>(["en"]);

export function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
}

export function preferredLocale(): Locale {
  return readStoredLocale() ?? detectLocale(typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
}

const initialLocale = preferredLocale();

const initPromise = i18n
  .use(initReactI18next)
  .init({
    resources: { en: { common: en } },
    lng: initialLocale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: LOCALE_CODES,
    defaultNS: "common",
    interpolation: { escapeValue: false },
  })
  .then(async () => {
    if (initialLocale !== "en") {
      await loadCatalog(initialLocale);
      await i18n.changeLanguage(initialLocale);
    }
    applyDocumentLocale(initialLocale);
  });

async function loadCatalog(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const catalog = await catalogLoaders[locale]();
  i18n.addResourceBundle(locale, "common", catalog.default);
  loadedLocales.add(locale);
}

export async function translatorFor(locale: Locale): Promise<TFunction> {
  await loadCatalog(locale);
  return i18n.getFixedT(locale);
}

export function ready(): Promise<void> {
  return initPromise;
}

export async function applyLocale(locale: Locale): Promise<void> {
  await loadCatalog(locale);
  await i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
}

export async function setLocale(locale: Locale): Promise<void> {
  await applyLocale(locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    return;
  }
}

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export default i18n;
