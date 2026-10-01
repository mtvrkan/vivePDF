import type { Locale } from "@/types";

export type LocaleMeta = { code: Locale; nativeName: string; dir: "ltr" | "rtl" };

export const LOCALES: LocaleMeta[] = [
  { code: "tr", nativeName: "Türkçe", dir: "ltr" },
  { code: "en", nativeName: "English", dir: "ltr" },
  { code: "de", nativeName: "Deutsch", dir: "ltr" },
  { code: "fr", nativeName: "Français", dir: "ltr" },
  { code: "es", nativeName: "Español", dir: "ltr" },
  { code: "it", nativeName: "Italiano", dir: "ltr" },
  { code: "pt-BR", nativeName: "Português (Brasil)", dir: "ltr" },
  { code: "ru", nativeName: "Русский", dir: "ltr" },
  { code: "ar", nativeName: "العربية", dir: "rtl" },
  { code: "zh-CN", nativeName: "简体中文", dir: "ltr" },
  { code: "ja", nativeName: "日本語", dir: "ltr" },
  { code: "ko", nativeName: "한국어", dir: "ltr" },
];

export const LOCALE_CODES: Locale[] = LOCALES.map((item) => item.code);
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as string[]).includes(value);
}

export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return LOCALES.find((item) => item.code === locale)?.dir ?? "ltr";
}

export function localeName(code: string): string {
  const lower = code.toLowerCase();
  const exact = LOCALES.find((item) => item.code.toLowerCase() === lower);
  if (exact) return exact.nativeName;
  const base = lower.split("-")[0];
  const byBase = LOCALES.find((item) => item.code.toLowerCase().split("-")[0] === base);
  return byBase?.nativeName ?? code;
}

export function localeGroupOrder(locale: Locale): (code: string) => number {
  const current = locale.split("-")[0].toLowerCase();
  return (code: string) => (code.split("-")[0].toLowerCase() === current ? 0 : 1);
}

export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = LOCALE_CODES.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split("-")[0];
    const byBase = LOCALE_CODES.find((code) => code.toLowerCase().split("-")[0] === base);
    if (byBase) return byBase;
  }
  return DEFAULT_LOCALE;
}

const TESSERACT_CODES: Record<Locale, string> = {
  tr: "tur",
  en: "eng",
  de: "deu",
  fr: "fra",
  es: "spa",
  it: "ita",
  "pt-BR": "por",
  ru: "rus",
  ar: "ara",
  "zh-CN": "chi_sim",
  ja: "jpn",
  ko: "kor",
};

export function defaultOcrLanguages(locale: Locale): string[] {
  const primary = TESSERACT_CODES[locale];
  return primary === "eng" ? ["eng"] : [primary, "eng"];
}

const TESSERACT_TAGS: Record<string, string> = {
  eng: "en", tur: "tr", deu: "de", fra: "fr", spa: "es", ita: "it", por: "pt", nld: "nl", pol: "pl", rus: "ru", ukr: "uk",
  ara: "ar", fas: "fa", heb: "he", hin: "hi", ben: "bn", jpn: "ja", kor: "ko", chi_sim: "zh-Hans", chi_tra: "zh-Hant",
  vie: "vi", tha: "th", ind: "id", msa: "ms", swe: "sv", nor: "no", dan: "da", fin: "fi", ell: "el", ces: "cs",
  slk: "sk", hun: "hu", ron: "ro", bul: "bg", hrv: "hr", srp: "sr", aze: "az", kaz: "kk", uzb: "uz", lat: "la",
};

export function tesseractLanguageName(code: string, uiLocale: string, fallback = code): string {
  const tag = TESSERACT_TAGS[code];
  if (!tag) return fallback;
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(tag) ?? fallback;
  } catch {
    return fallback;
  }
}
