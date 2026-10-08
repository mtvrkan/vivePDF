import { isLocale } from "@/app/locales";
import type { Locale } from "@/types";
import type { StudioCrop } from "@/types/studio";

export const CV_SECTION_KEYS = ["summary", "experience", "education", "skills", "languages", "certificates", "projects", "references", "interests", "custom"] as const;
export type CvSectionKey = (typeof CV_SECTION_KEYS)[number];

export const CV_CONTACT_KINDS = ["email", "phone", "website", "location", "linkedin", "github", "other"] as const;
export type CvContactKind = (typeof CV_CONTACT_KINDS)[number];

export const CV_LAYOUT_IDS = ["modern", "classic", "corporate", "minimal", "creative", "timeline", "compact", "elegant", "tech", "ats", "executive", "academic", "designer", "infographic"] as const;
export type CvLayoutId = (typeof CV_LAYOUT_IDS)[number];

export const CV_PHOTO_SHAPES = ["circle", "rounded", "square", "none"] as const;
export type CvPhotoShape = (typeof CV_PHOTO_SHAPES)[number];

export const CV_SKILL_STYLES = ["bars", "dots", "chips", "text"] as const;
export type CvSkillStyle = (typeof CV_SKILL_STYLES)[number];

export const CV_PAPERS = ["a4", "letter"] as const;
export type CvPaper = (typeof CV_PAPERS)[number];

export const CV_DENSITIES = ["compact", "normal", "roomy"] as const;
export type CvDensity = (typeof CV_DENSITIES)[number];

export const MAX_LEVEL = 5;
export const CV_LIMITS = { contacts: 10, experience: 30, education: 20, skills: 60, languages: 20, certificates: 30, projects: 30, references: 10, custom: 10 } as const;
export const CV_TEXT_LIMIT = 4000;
export const CV_STORAGE_KEY = "vivepdf.cvStudio";
export const LEGACY_DRAFT_KEY = "vivepdf.cvDraft";
export const CV_FILE_FORMAT = "vivepdf-cv";
export const CV_FILE_VERSION = 1;

export type CvContact = { id: string; kind: CvContactKind; value: string };
export type CvExperience = { id: string; role: string; organisation: string; location: string; start: string; end: string; current: boolean; details: string };
export type CvEducation = { id: string; degree: string; school: string; location: string; start: string; end: string; current: boolean; details: string };
export type CvLeveled = { id: string; name: string; level: number };
export type CvCertificate = { id: string; name: string; issuer: string; date: string };
export type CvProject = { id: string; name: string; link: string; details: string };
export type CvReference = { id: string; name: string; role: string; contact: string };
export type CvCustom = { id: string; heading: string; body: string };

export type CvProfile = {
  name: string;
  headline: string;
  photo: string | null;
  photoCrop: StudioCrop | null;
  contacts: CvContact[];
  summary: string;
  experience: CvExperience[];
  education: CvEducation[];
  skills: CvLeveled[];
  languages: CvLeveled[];
  certificates: CvCertificate[];
  projects: CvProject[];
  references: CvReference[];
  interests: string;
  custom: CvCustom[];
  order: CvSectionKey[];
  hidden: CvSectionKey[];
};

export type CvTheme = {
  layout: CvLayoutId;
  accent: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  photoShape: CvPhotoShape;
  skillStyle: CvSkillStyle;
  paper: CvPaper;
  density: CvDensity;
  language: Locale;
};

export type CvState = { profile: CvProfile; theme: CvTheme };

let sequence = 0;

export function cvId(): string {
  sequence += 1;
  return `cv${Date.now().toString(36)}${sequence.toString(36)}`;
}

export function emptyExperience(): CvExperience {
  return { id: cvId(), role: "", organisation: "", location: "", start: "", end: "", current: false, details: "" };
}

export function emptyEducation(): CvEducation {
  return { id: cvId(), degree: "", school: "", location: "", start: "", end: "", current: false, details: "" };
}

export function emptyLeveled(level = 3): CvLeveled {
  return { id: cvId(), name: "", level };
}

export function emptyCertificate(): CvCertificate {
  return { id: cvId(), name: "", issuer: "", date: "" };
}

export function emptyProject(): CvProject {
  return { id: cvId(), name: "", link: "", details: "" };
}

export function emptyReference(): CvReference {
  return { id: cvId(), name: "", role: "", contact: "" };
}

export function emptyCustom(): CvCustom {
  return { id: cvId(), heading: "", body: "" };
}

export function emptyContact(kind: CvContactKind = "email"): CvContact {
  return { id: cvId(), kind, value: "" };
}

export function emptyProfile(): CvProfile {
  return {
    name: "",
    headline: "",
    photo: null,
    photoCrop: null,
    contacts: [emptyContact("email"), emptyContact("phone"), emptyContact("location")],
    summary: "",
    experience: [emptyExperience()],
    education: [emptyEducation()],
    skills: [],
    languages: [],
    certificates: [],
    projects: [],
    references: [],
    interests: "",
    custom: [],
    order: [...CV_SECTION_KEYS],
    hidden: [],
  };
}

export function defaultTheme(language: Locale): CvTheme {
  return { layout: "modern", accent: null, headingFont: null, bodyFont: null, photoShape: "circle", skillStyle: "bars", paper: "a4", density: "normal", language };
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function sampleProfile(t: Translate): CvProfile {
  const line = (key: string) => t(`studio.cv.sample.${key}`);
  return {
    name: line("name"),
    headline: line("headline"),
    photo: null,
    photoCrop: null,
    contacts: [
      { id: cvId(), kind: "email", value: line("email") },
      { id: cvId(), kind: "phone", value: line("phone") },
      { id: cvId(), kind: "location", value: line("location") },
      { id: cvId(), kind: "linkedin", value: line("linkedin") },
    ],
    summary: line("summary"),
    experience: [
      { id: cvId(), role: line("role1"), organisation: line("company1"), location: line("city1"), start: "2021", end: "", current: true, details: line("details1") },
      { id: cvId(), role: line("role2"), organisation: line("company2"), location: line("city2"), start: "2018", end: "2021", current: false, details: line("details2") },
    ],
    education: [{ id: cvId(), degree: line("degree"), school: line("school"), location: line("city2"), start: "2014", end: "2018", current: false, details: line("educationDetails") }],
    skills: [line("skill1"), line("skill2"), line("skill3"), line("skill4"), line("skill5")].map((name, index) => ({ id: cvId(), name, level: [5, 4, 4, 3, 4][index] ?? 3 })),
    languages: [
      { id: cvId(), name: line("language1"), level: 5 },
      { id: cvId(), name: line("language2"), level: 4 },
    ],
    certificates: [{ id: cvId(), name: line("certificate"), issuer: line("issuer"), date: "2022" }],
    projects: [],
    references: [],
    interests: line("interests"),
    custom: [],
    order: [...CV_SECTION_KEYS],
    hidden: [],
  };
}

function str(value: unknown, limit = CV_TEXT_LIMIT): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function list<T>(value: unknown, limit: number, read: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .slice(0, limit)
    .map(read);
}

function level(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(MAX_LEVEL, Math.round(value))) : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function fraction(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function photoCrop(value: unknown): StudioCrop | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const [x, y, width, height] = [fraction(raw.x), fraction(raw.y), fraction(raw.width), fraction(raw.height)];
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
  if (x + width > 1.0001 || y + height > 1.0001) return null;
  return { x, y, width, height };
}

function sectionKeys(value: unknown): CvSectionKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is CvSectionKey => CV_SECTION_KEYS.includes(item as CvSectionKey)))];
}

function fullOrder(value: unknown): CvSectionKey[] {
  const known = sectionKeys(value);
  return [...known, ...CV_SECTION_KEYS.filter((key) => !known.includes(key))];
}

function fontId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

export function normalizeProfile(value: unknown): CvProfile {
  const empty = emptyProfile();
  if (typeof value !== "object" || value === null) return empty;
  const raw = value as Record<string, unknown>;
  return {
    name: str(raw.name, 200),
    headline: str(raw.headline, 200),
    photo: typeof raw.photo === "string" && raw.photo ? raw.photo : null,
    photoCrop: photoCrop(raw.photoCrop),
    contacts: list(raw.contacts, CV_LIMITS.contacts, (item) => ({ id: cvId(), kind: oneOf(item.kind, CV_CONTACT_KINDS, "other"), value: str(item.value, 300) })),
    summary: str(raw.summary),
    experience: list(raw.experience, CV_LIMITS.experience, (item) => ({
      id: cvId(),
      role: str(item.role, 200),
      organisation: str(item.organisation, 200),
      location: str(item.location, 200),
      start: str(item.start, 40),
      end: str(item.end, 40),
      current: item.current === true,
      details: str(item.details),
    })),
    education: list(raw.education, CV_LIMITS.education, (item) => ({
      id: cvId(),
      degree: str(item.degree, 200),
      school: str(item.school, 200),
      location: str(item.location, 200),
      start: str(item.start, 40),
      end: str(item.end, 40),
      current: item.current === true,
      details: str(item.details),
    })),
    skills: list(raw.skills, CV_LIMITS.skills, (item) => ({ id: cvId(), name: str(item.name, 120), level: level(item.level, 3) })),
    languages: list(raw.languages, CV_LIMITS.languages, (item) => ({ id: cvId(), name: str(item.name, 120), level: level(item.level, 3) })),
    certificates: list(raw.certificates, CV_LIMITS.certificates, (item) => ({ id: cvId(), name: str(item.name, 200), issuer: str(item.issuer, 200), date: str(item.date, 40) })),
    projects: list(raw.projects, CV_LIMITS.projects, (item) => ({ id: cvId(), name: str(item.name, 200), link: str(item.link, 300), details: str(item.details) })),
    references: list(raw.references, CV_LIMITS.references, (item) => ({ id: cvId(), name: str(item.name, 200), role: str(item.role, 200), contact: str(item.contact, 300) })),
    interests: str(raw.interests, 1000),
    custom: list(raw.custom, CV_LIMITS.custom, (item) => ({ id: cvId(), heading: str(item.heading, 120), body: str(item.body) })),
    order: fullOrder(raw.order),
    hidden: sectionKeys(raw.hidden),
  };
}

export function normalizeTheme(value: unknown, language: Locale): CvTheme {
  const fallback = defaultTheme(language);
  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  return {
    layout: oneOf(raw.layout, CV_LAYOUT_IDS, fallback.layout),
    accent: typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent.toLowerCase() : null,
    headingFont: fontId(raw.headingFont),
    bodyFont: fontId(raw.bodyFont),
    photoShape: oneOf(raw.photoShape, CV_PHOTO_SHAPES, fallback.photoShape),
    skillStyle: oneOf(raw.skillStyle, CV_SKILL_STYLES, fallback.skillStyle),
    paper: oneOf(raw.paper, CV_PAPERS, fallback.paper),
    density: oneOf(raw.density, CV_DENSITIES, fallback.density),
    language: isLocale(raw.language) ? raw.language : language,
  };
}

function legacyEntries(value: unknown, limit: number): Array<Record<string, string>> {
  return list(value, limit, (item) => ({ title: str(item.title, 200), organisation: str(item.organisation, 200), location: str(item.location, 200), period: str(item.period, 80), details: str(item.details) }));
}

function splitPeriod(period: string): { start: string; end: string } {
  const [start = "", end = ""] = period.split(/\s*[–—-]\s*/);
  return { start: start.trim(), end: end.trim() };
}

function contactKind(value: string): CvContactKind {
  if (/@/.test(value)) return "email";
  if (/linkedin\./i.test(value)) return "linkedin";
  if (/github\./i.test(value)) return "github";
  if (/^(https?:\/\/|www\.)/i.test(value)) return "website";
  if (/^[+\d][\d\s().-]{6,}$/.test(value)) return "phone";
  return "other";
}

export function fromLegacyDraft(raw: string, language: Locale): CvState | null {
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (typeof stored !== "object" || stored === null) return null;
    const profile = emptyProfile();
    profile.name = str(stored.name, 200);
    profile.headline = str(stored.headline, 200);
    profile.photo = typeof stored.photo === "string" && stored.photo ? stored.photo : null;
    profile.summary = str(stored.summary);
    profile.contacts = str(stored.contacts)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, CV_LIMITS.contacts)
      .map((value) => ({ id: cvId(), kind: contactKind(value), value }));
    profile.experience = legacyEntries(stored.experience, CV_LIMITS.experience).map((entry) => ({
      id: cvId(),
      role: entry.title,
      organisation: entry.organisation,
      location: entry.location,
      ...splitPeriod(entry.period),
      current: false,
      details: entry.details,
    }));
    profile.education = legacyEntries(stored.education, CV_LIMITS.education).map((entry) => ({
      id: cvId(),
      degree: entry.title,
      school: entry.organisation,
      location: entry.location,
      ...splitPeriod(entry.period),
      current: false,
      details: entry.details,
    }));
    profile.skills = str(stored.skills)
      .split(/[\n,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, CV_LIMITS.skills)
      .map((name) => ({ id: cvId(), name, level: 0 }));
    profile.languages = str(stored.languages)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, CV_LIMITS.languages)
      .map((name) => ({ id: cvId(), name, level: 0 }));
    profile.custom = list(stored.sections, CV_LIMITS.custom, (item) => ({ id: cvId(), heading: str(item.heading, 120), body: str(item.body) }));
    const theme = defaultTheme(isLocale(stored.language) ? stored.language : language);
    const accent = str(stored.accent);
    if (/^#[0-9a-f]{6}$/i.test(accent)) theme.accent = accent.toLowerCase();
    if (stored.paper === "letter") theme.paper = "letter";
    theme.layout = stored.template === "classic" ? "classic" : stored.template === "compact" ? "compact" : "modern";
    return { profile, theme };
  } catch {
    return null;
  }
}

export function readStoredCv(language: Locale): CvState | null {
  try {
    const raw = localStorage.getItem(CV_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, unknown>;
      return { profile: normalizeProfile(stored.profile), theme: normalizeTheme(stored.theme, language) };
    }
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    return legacy ? fromLegacyDraft(legacy, language) : null;
  } catch {
    return null;
  }
}

export function writeStoredCv(state: CvState): boolean {
  try {
    localStorage.setItem(CV_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function portable(profile: CvProfile) {
  const strip = <T extends { id: string }>(items: T[]) =>
    items.map((item) => {
      const copy: Record<string, unknown> = { ...item };
      delete copy.id;
      return copy;
    });
  return {
    ...profile,
    contacts: strip(profile.contacts),
    experience: strip(profile.experience),
    education: strip(profile.education),
    skills: strip(profile.skills),
    languages: strip(profile.languages),
    certificates: strip(profile.certificates),
    projects: strip(profile.projects),
    references: strip(profile.references),
    custom: strip(profile.custom),
  };
}

export function cvToJson(state: CvState): string {
  return `${JSON.stringify({ format: CV_FILE_FORMAT, version: CV_FILE_VERSION, profile: portable(state.profile), theme: state.theme }, null, 2)}\n`;
}

export function cvFromJson(text: string, language: Locale): CvState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.format === CV_FILE_FORMAT) {
    if (typeof raw.version !== "number" || raw.version > CV_FILE_VERSION) return null;
    return { profile: normalizeProfile(raw.profile), theme: normalizeTheme(raw.theme, language) };
  }
  if (typeof raw.profile === "object" && raw.profile !== null) return { profile: normalizeProfile(raw.profile), theme: normalizeTheme(raw.theme, language) };
  if (typeof raw.name === "string" || Array.isArray(raw.experience)) return { profile: normalizeProfile(raw), theme: defaultTheme(language) };
  return null;
}

export function splitListText(text: string): string[] {
  return text
    .split(/\r?\n|[,;•|]/)
    .map((item) => item.replace(/^\s*[-*–]\s+/, "").trim())
    .filter(Boolean);
}

export function profileHasContent(profile: CvProfile): boolean {
  return Boolean(profile.name.trim() || profile.headline.trim() || profile.photo) || CV_SECTION_KEYS.some((key) => sectionVisible({ ...profile, hidden: [] }, key)) || profile.contacts.some((contact) => contact.value.trim());
}

export function sectionVisible(profile: CvProfile, key: CvSectionKey): boolean {
  if (profile.hidden.includes(key)) return false;
  if (key === "summary") return profile.summary.trim() !== "";
  if (key === "interests") return profile.interests.trim() !== "";
  if (key === "experience") return profile.experience.some((item) => [item.role, item.organisation, item.details].some((value) => value.trim()));
  if (key === "education") return profile.education.some((item) => [item.degree, item.school, item.details].some((value) => value.trim()));
  if (key === "skills") return profile.skills.some((item) => item.name.trim());
  if (key === "languages") return profile.languages.some((item) => item.name.trim());
  if (key === "certificates") return profile.certificates.some((item) => item.name.trim());
  if (key === "projects") return profile.projects.some((item) => item.name.trim() || item.details.trim());
  if (key === "references") return profile.references.some((item) => item.name.trim());
  return profile.custom.some((item) => item.heading.trim() || item.body.trim());
}
