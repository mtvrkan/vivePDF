import batukarAvatar from "./avatars/batukar.png";
import bkguzelAvatar from "./avatars/bkguzel.png";
import kilincesadAvatar from "./avatars/kilincesad.png";
import ownerAvatar from "./avatars/mtvrkan.png";

export type Contributor = {
  login: string;
  name: string;
  roleKey: string;
  htmlUrl: string;
  avatarUrl: string | null;
  contributions: number | null;
};

export const CONTRIBUTORS: Contributor[] = [
  {
    login: "mtvrkan",
    name: "Mehmet Türkan",
    roleKey: "about.credits.roles.founder",
    htmlUrl: "https://github.com/mtvrkan",
    avatarUrl: ownerAvatar,
    contributions: null,
  },
];

export const THANKS: Contributor[] = [
  {
    login: "batukar",
    name: "Batuhan Karadağ",
    roleKey: "about.credits.roles.supporter",
    htmlUrl: "https://github.com/batukar",
    avatarUrl: batukarAvatar,
    contributions: null,
  },
  {
    login: "kilincesad",
    name: "Muhammed Esad Kılınç",
    roleKey: "about.credits.roles.supporter",
    htmlUrl: "https://github.com/kilincesad",
    avatarUrl: kilincesadAvatar,
    contributions: null,
  },
  {
    login: "bkguzel",
    name: "Burak Kemal Güzel",
    roleKey: "about.credits.roles.supporter",
    htmlUrl: "https://github.com/bkguzel",
    avatarUrl: bkguzelAvatar,
    contributions: null,
  },
];

export const WEBSITE_URL = "https://vivepdf.com";
export const REPO_URL = "https://github.com/mtvrkan/vivePDF";

export type ThirdPartyEntry = { name: string; licence: string; url: string };

export const THIRD_PARTY: ThirdPartyEntry[] = [
  { name: "PyMuPDF / MuPDF", licence: "AGPL-3.0", url: "https://mupdf.com" },
  { name: "PDFium", licence: "BSD-3-Clause", url: "https://pdfium.googlesource.com/pdfium" },
  { name: "EmbedPDF", licence: "MIT", url: "https://www.embedpdf.com" },
  { name: "Tesseract OCR", licence: "Apache-2.0", url: "https://github.com/tesseract-ocr/tesseract" },
  { name: "LibreOffice", licence: "MPL-2.0", url: "https://www.libreoffice.org" },
  { name: "Piper TTS", licence: "GPL-3.0", url: "https://github.com/OHF-Voice/piper1-gpl" },
  { name: "espeak-ng", licence: "GPL-3.0", url: "https://github.com/espeak-ng/espeak-ng" },
  { name: "Argos Translate", licence: "MIT", url: "https://github.com/argosopentech/argos-translate" },
  { name: "OPUS-MT (Helsinki-NLP)", licence: "CC BY 4.0", url: "https://github.com/Helsinki-NLP/Tatoeba-Challenge" },
  { name: "CTranslate2", licence: "MIT", url: "https://github.com/OpenNMT/CTranslate2" },
  { name: "SentencePiece", licence: "Apache-2.0", url: "https://github.com/google/sentencepiece" },
  { name: "pyHanko", licence: "MIT", url: "https://github.com/MatthiasValvekens/pyHanko" },
  { name: "zxing-cpp", licence: "Apache-2.0", url: "https://github.com/zxing-cpp/zxing-cpp" },
  { name: "olefile", licence: "BSD-2-Clause", url: "https://github.com/decalage2/olefile" },
  { name: "Pillow", licence: "MIT-CMU", url: "https://python-pillow.org" },
  { name: "NumPy", licence: "BSD-3-Clause", url: "https://numpy.org" },
  { name: "MathJax", licence: "Apache-2.0", url: "https://www.mathjax.org" },
  { name: "New Computer Modern", licence: "GUST Font License", url: "https://ctan.org/pkg/newcomputermodern" },
  { name: "pdf2docx", licence: "MIT", url: "https://github.com/ArtifexSoftware/pdf2docx" },
  { name: "python-pptx", licence: "MIT", url: "https://github.com/scanny/python-pptx" },
  { name: "openpyxl", licence: "MIT", url: "https://foss.heptapod.net/openpyxl/openpyxl" },
  { name: "fonttools", licence: "MIT", url: "https://github.com/fonttools/fonttools" },
  { name: "pydantic", licence: "MIT", url: "https://github.com/pydantic/pydantic" },
  { name: "PyInstaller", licence: "GPL-2.0 with exception", url: "https://www.pyinstaller.org" },
  { name: "Tauri", licence: "MIT / Apache-2.0", url: "https://tauri.app" },
  { name: "React", licence: "MIT", url: "https://react.dev" },
  { name: "Tailwind CSS", licence: "MIT", url: "https://tailwindcss.com" },
  { name: "i18next", licence: "MIT", url: "https://www.i18next.com" },
  { name: "zustand", licence: "MIT", url: "https://github.com/pmndrs/zustand" },
  { name: "lucide", licence: "ISC", url: "https://lucide.dev" },
  { name: "Geist", licence: "OFL-1.1", url: "https://vercel.com/font" },
  { name: "IBM Plex", licence: "OFL-1.1", url: "https://www.ibm.com/plex" },
  { name: "DejaVu Fonts", licence: "Bitstream Vera", url: "https://dejavu-fonts.github.io" },
  { name: "Google Fonts (Studio font library, downloaded on request)", licence: "OFL-1.1", url: "https://github.com/google/fonts" },
  { name: "SecLists common passwords", licence: "MIT", url: "https://github.com/danielmiessler/SecLists" },
  { name: "Have I Been Pwned: Pwned Passwords", licence: "CC BY 4.0", url: "https://haveibeenpwned.com/Passwords" },
];

export function sizedAvatarUrl(url: string, size = 128): string {
  if (!url.startsWith("https://avatars.githubusercontent.com/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}s=${size}`;
}

export const CONTRIBUTORS_API_URL = "https://api.github.com/repos/mtvrkan/vivePDF/contributors?per_page=50";

export type FetchedContributor = { login: string; htmlUrl: string; avatarUrl: string; contributions: number };

export function parseContributors(raw: unknown): FetchedContributor[] {
  if (!Array.isArray(raw)) return [];
  const result: FetchedContributor[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { login, html_url: htmlUrl, avatar_url: avatarUrl, contributions } = item as Record<string, unknown>;
    if (typeof login !== "string" || typeof htmlUrl !== "string" || typeof avatarUrl !== "string" || typeof contributions !== "number") continue;
    result.push({ login, htmlUrl, avatarUrl, contributions });
  }
  return result;
}

export function mergeContributors(curated: Contributor[], fetched: FetchedContributor[]): Contributor[] {
  const fetchedByLogin = new Map(fetched.map((entry) => [entry.login.toLowerCase(), entry]));
  const curatedLogins = new Set(curated.map((entry) => entry.login.toLowerCase()));

  const mergedCurated = curated.map((entry) => {
    const match = fetchedByLogin.get(entry.login.toLowerCase());
    if (!match) return entry;
    return { ...entry, avatarUrl: entry.avatarUrl ?? match.avatarUrl, contributions: match.contributions };
  });

  const fetchedOnly = fetched
    .filter((entry) => !curatedLogins.has(entry.login.toLowerCase()))
    .sort((a, b) => b.contributions - a.contributions)
    .map((entry): Contributor => ({
      login: entry.login,
      name: entry.login,
      roleKey: "about.credits.roles.contributor",
      htmlUrl: entry.htmlUrl,
      avatarUrl: entry.avatarUrl,
      contributions: entry.contributions,
    }));

  return [...mergedCurated, ...fetchedOnly];
}
