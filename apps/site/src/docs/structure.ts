import type { Locale } from "../i18n";

export type DocGroupKey = "start" | "howto" | "documents" | "studio" | "present" | "privacy" | "reference" | "developers";

export type DocKey =
  | "install"
  | "interface"
  | "firstSteps"
  | "howMerge"
  | "howCompress"
  | "howPdfToWord"
  | "howOfficeToPdf"
  | "howImagesToPdf"
  | "howFillForm"
  | "howSign"
  | "howEditText"
  | "howAnnotate"
  | "howDeletePages"
  | "howSplit"
  | "howPassword"
  | "howRedact"
  | "openRead"
  | "pages"
  | "convert"
  | "ocr"
  | "sign"
  | "security"
  | "studioDocument"
  | "studioDesign"
  | "present"
  | "settingsPrivacy"
  | "offline"
  | "shortcuts"
  | "tools"
  | "releaseNotes"
  | "faq"
  | "troubleshooting"
  | "buildFromSource"
  | "license";

export type DocEntry = { key: DocKey; group: DocGroupKey; icon: string; slug: Record<Locale, string> };

export const DOC_GROUPS: DocGroupKey[] = ["start", "howto", "documents", "studio", "present", "privacy", "reference", "developers"];

export const DOCS: DocEntry[] = [
  { key: "install", group: "start", icon: "i-down", slug: { tr: "kurulum", en: "installation" } },
  { key: "interface", group: "start", icon: "i-home", slug: { tr: "arayuz", en: "interface" } },
  { key: "firstSteps", group: "start", icon: "i-arrow", slug: { tr: "ilk-adimlar", en: "first-steps" } },
  { key: "howMerge", group: "howto", icon: "i-merge", slug: { tr: "pdf-birlestirme", en: "merge-pdfs" } },
  { key: "howCompress", group: "howto", icon: "i-shrink", slug: { tr: "pdf-kucultme", en: "compress-a-pdf" } },
  { key: "howPdfToWord", group: "howto", icon: "i-convert", slug: { tr: "pdf-word-cevirme", en: "pdf-to-word" } },
  { key: "howOfficeToPdf", group: "howto", icon: "i-convert", slug: { tr: "word-pdf-cevirme", en: "office-to-pdf" } },
  { key: "howImagesToPdf", group: "howto", icon: "i-pages", slug: { tr: "fotograflardan-pdf", en: "images-to-pdf" } },
  { key: "howFillForm", group: "howto", icon: "i-form", slug: { tr: "form-doldurma", en: "fill-a-form" } },
  { key: "howSign", group: "howto", icon: "i-sign", slug: { tr: "pdf-imzalama", en: "sign-a-pdf" } },
  { key: "howEditText", group: "howto", icon: "i-edit", slug: { tr: "pdf-metin-duzenleme", en: "edit-pdf-text" } },
  { key: "howAnnotate", group: "howto", icon: "i-hl", slug: { tr: "vurgulama-not-ekleme", en: "highlight-and-annotate" } },
  { key: "howDeletePages", group: "howto", icon: "i-pages", slug: { tr: "sayfa-silme", en: "delete-pages" } },
  { key: "howSplit", group: "howto", icon: "i-pages", slug: { tr: "pdf-bolme", en: "split-a-pdf" } },
  { key: "howPassword", group: "howto", icon: "i-lock", slug: { tr: "pdf-parola-koyma", en: "password-protect-a-pdf" } },
  { key: "howRedact", group: "howto", icon: "i-eyeoff", slug: { tr: "pdf-karartma", en: "redact-a-pdf" } },
  { key: "openRead", group: "documents", icon: "i-eye", slug: { tr: "acma-okuma", en: "open-and-read" } },
  { key: "pages", group: "documents", icon: "i-pages", slug: { tr: "sayfalar", en: "pages" } },
  { key: "convert", group: "documents", icon: "i-convert", slug: { tr: "donusturme", en: "convert" } },
  { key: "ocr", group: "documents", icon: "i-scan", slug: { tr: "ocr", en: "ocr" } },
  { key: "sign", group: "documents", icon: "i-sign", slug: { tr: "imza", en: "sign" } },
  { key: "security", group: "documents", icon: "i-lock", slug: { tr: "guvenlik", en: "security" } },
  { key: "studioDocument", group: "studio", icon: "i-edit", slug: { tr: "studio-belge", en: "studio-document" } },
  { key: "studioDesign", group: "studio", icon: "i-form", slug: { tr: "studio-tasarim", en: "studio-design" } },
  { key: "present", group: "present", icon: "i-present", slug: { tr: "sunum", en: "present" } },
  { key: "settingsPrivacy", group: "privacy", icon: "i-eyeoff", slug: { tr: "ayarlar-gizlilik", en: "settings-privacy" } },
  { key: "offline", group: "privacy", icon: "i-cloudoff", slug: { tr: "cevrimdisi", en: "offline" } },
  { key: "shortcuts", group: "reference", icon: "i-key", slug: { tr: "kisayollar", en: "shortcuts" } },
  { key: "tools", group: "reference", icon: "i-convert", slug: { tr: "araclar", en: "tools" } },
  { key: "releaseNotes", group: "reference", icon: "i-gift", slug: { tr: "surum-notlari", en: "release-notes" } },
  { key: "faq", group: "reference", icon: "i-book", slug: { tr: "sss", en: "faq" } },
  { key: "troubleshooting", group: "reference", icon: "i-life", slug: { tr: "sorun-giderme", en: "troubleshooting" } },
  { key: "buildFromSource", group: "developers", icon: "i-code", slug: { tr: "kaynaktan-derleme", en: "build-from-source" } },
  { key: "license", group: "developers", icon: "i-book", slug: { tr: "lisans", en: "license" } },
];

export function docByKey(key: DocKey): DocEntry {
  const entry = DOCS.find((d) => d.key === key);
  if (!entry) throw new Error(`Unknown doc key: ${key}`);
  return entry;
}

export function docBySlug(locale: Locale, slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug[locale] === slug);
}
