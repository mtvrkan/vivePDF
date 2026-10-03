import { isLocale } from "@/app/locales";
import type { CreateCvParams, CreateFont, CvEntry, CvLabels, CvSection, CvTemplate, Locale } from "@/types";
import { CREATE_FONTS, DEFAULT_ACCENT } from "./createDocument";

export const CV_TEMPLATES: CvTemplate[] = ["classic", "modern", "compact"];
export const CV_PAPERS = ["a4", "letter"] as const;
export type CvPaper = (typeof CV_PAPERS)[number];
export const CV_PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const CV_DRAFT_KEY = "vivepdf.cvDraft";
export const CV_LABEL_KEYS = ["summary", "experience", "education", "skills", "languages", "contact"] as const;
export const MAX_CV_CONTACTS = 8;
export const MAX_CV_EXPERIENCE = 30;
export const MAX_CV_EDUCATION = 20;
export const MAX_CV_SECTIONS = 10;
const MAX_SKILLS = 60;
const MAX_LANGUAGES = 20;

export type CvDraftEntry = CvEntry & { id: string };
export type CvDraftSection = CvSection & { id: string };
export type CvDraft = {
  template: CvTemplate;
  language: Locale;
  name: string;
  headline: string;
  contacts: string;
  photo: string | null;
  summary: string;
  experience: CvDraftEntry[];
  education: CvDraftEntry[];
  skills: string;
  languages: string;
  sections: CvDraftSection[];
  accent: string;
  font: CreateFont;
  paper: CvPaper;
};

let nextId = 0;

export function draftId(): string {
  nextId += 1;
  return `cv-${Date.now().toString(36)}-${nextId}`;
}

export function emptyEntry(): CvDraftEntry {
  return { id: draftId(), title: "", organisation: "", location: "", period: "", details: "" };
}

export function emptySection(): CvDraftSection {
  return { id: draftId(), heading: "", body: "" };
}

export function emptyCvDraft(language: Locale): CvDraft {
  return {
    template: "classic",
    language,
    name: "",
    headline: "",
    contacts: "",
    photo: null,
    summary: "",
    experience: [emptyEntry()],
    education: [emptyEntry()],
    skills: "",
    languages: "",
    sections: [],
    accent: DEFAULT_ACCENT,
    font: "sans",
    paper: "a4",
  };
}

export function linesOf(text: string, limit: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function skillsOf(text: string): string[] {
  return text
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_SKILLS);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function entries(value: unknown, limit: number): CvDraftEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item: Record<string, unknown>) => ({
    id: draftId(),
    title: text(item?.title),
    organisation: text(item?.organisation),
    location: text(item?.location),
    period: text(item?.period),
    details: text(item?.details),
  }));
}

function sections(value: unknown): CvDraftSection[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CV_SECTIONS).map((item: Record<string, unknown>) => ({ id: draftId(), heading: text(item?.heading), body: text(item?.body) }));
}

export function parseCvDraft(raw: string | null, language: Locale): CvDraft {
  const empty = emptyCvDraft(language);
  if (!raw) return empty;
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (typeof stored !== "object" || stored === null) return empty;
    return {
      template: CV_TEMPLATES.includes(stored.template as CvTemplate) ? (stored.template as CvTemplate) : empty.template,
      language: isLocale(stored.language) ? stored.language : language,
      name: text(stored.name),
      headline: text(stored.headline),
      contacts: text(stored.contacts),
      photo: typeof stored.photo === "string" && stored.photo ? stored.photo : null,
      summary: text(stored.summary),
      experience: entries(stored.experience, MAX_CV_EXPERIENCE),
      education: entries(stored.education, MAX_CV_EDUCATION),
      skills: text(stored.skills),
      languages: text(stored.languages),
      sections: sections(stored.sections),
      accent: /^#[0-9a-f]{6}$/i.test(text(stored.accent)) ? text(stored.accent) : empty.accent,
      font: CREATE_FONTS.includes(stored.font as CreateFont) ? (stored.font as CreateFont) : empty.font,
      paper: CV_PAPERS.includes(stored.paper as CvPaper) ? (stored.paper as CvPaper) : empty.paper,
    };
  } catch {
    return empty;
  }
}

export function readCvDraft(language: Locale): CvDraft {
  try {
    return parseCvDraft(localStorage.getItem(CV_DRAFT_KEY), language);
  } catch {
    return emptyCvDraft(language);
  }
}

export function writeCvDraft(draft: CvDraft): void {
  try {
    localStorage.setItem(CV_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    return;
  }
}

function entryOf({ title, organisation, location, period, details }: CvDraftEntry): CvEntry {
  return { title, organisation, location, period, details };
}

function sectionOf({ heading, body }: CvDraftSection): CvSection {
  return { heading, body };
}

function filledEntry(entry: CvEntry): boolean {
  return [entry.title, entry.organisation, entry.location, entry.period, entry.details].some((value) => value.trim());
}

export function cvParams(draft: CvDraft, labels: CvLabels, output: string): CreateCvParams {
  return {
    template: draft.template,
    name: draft.name,
    headline: draft.headline,
    contacts: linesOf(draft.contacts, MAX_CV_CONTACTS),
    photo: draft.photo ?? undefined,
    summary: draft.summary,
    experience: draft.experience.map(entryOf).filter(filledEntry),
    education: draft.education.map(entryOf).filter(filledEntry),
    skills: skillsOf(draft.skills),
    languages: linesOf(draft.languages, MAX_LANGUAGES),
    sections: draft.sections.map(sectionOf).filter((section) => section.heading.trim() && section.body.trim()),
    labels,
    accent: draft.accent,
    font: draft.font,
    paper: draft.paper,
    output,
  };
}

export function movedItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
