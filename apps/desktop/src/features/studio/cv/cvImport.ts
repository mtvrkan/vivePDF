import { CV_LIMITS, normalizeProfile, type CvProfile } from "./cvModel";

export const IMPORT_KEYS = ["personal", "contact", "summary", "experience", "education", "skills", "languages", "certificates", "projects", "references", "interests", "custom"] as const;
export type ImportKey = (typeof IMPORT_KEYS)[number];
export type ImportMode = "replace" | "add";

type ListKey = keyof typeof CV_LIMITS;

const LIST_KEYS: Record<Exclude<ImportKey, "personal" | "summary" | "interests">, ListKey> = {
  contact: "contacts",
  experience: "experience",
  education: "education",
  skills: "skills",
  languages: "languages",
  certificates: "certificates",
  projects: "projects",
  references: "references",
  custom: "custom",
};

export function isImportKey(value: string): value is ImportKey {
  return (IMPORT_KEYS as readonly string[]).includes(value);
}

export function importCounts(profile: CvProfile): Record<ImportKey, number> {
  return {
    personal: [profile.name, profile.headline].filter((value) => value.trim()).length,
    contact: profile.contacts.length,
    summary: profile.summary.trim() ? 1 : 0,
    experience: profile.experience.length,
    education: profile.education.length,
    skills: profile.skills.length,
    languages: profile.languages.length,
    certificates: profile.certificates.length,
    projects: profile.projects.length,
    references: profile.references.length,
    interests: profile.interests.trim() ? 1 : 0,
    custom: profile.custom.length,
  };
}

function pickText(current: string, incoming: string, mode: ImportMode): string {
  if (!incoming.trim()) return current;
  return mode === "replace" || !current.trim() ? incoming : current;
}

function joinText(current: string, incoming: string, separator: string): string {
  if (!incoming.trim()) return current;
  if (!current.trim()) return incoming;
  return `${current}${separator}${incoming}`;
}

function filledOnly<T extends object>(items: T[]): T[] {
  return items.filter((item) => Object.entries(item).some(([key, value]) => key !== "id" && key !== "level" && key !== "kind" && typeof value === "string" && value.trim()));
}

export function applyImport(current: CvProfile, raw: unknown, keys: ReadonlySet<ImportKey>, mode: ImportMode): CvProfile {
  const incoming = normalizeProfile(raw);
  const next: CvProfile = { ...current };
  if (keys.has("personal")) {
    next.name = pickText(current.name, incoming.name, mode);
    next.headline = pickText(current.headline, incoming.headline, mode);
  }
  if (keys.has("summary")) next.summary = mode === "replace" ? pickText(current.summary, incoming.summary, mode) : joinText(current.summary, incoming.summary, "\n\n");
  if (keys.has("interests")) next.interests = mode === "replace" ? pickText(current.interests, incoming.interests, mode) : joinText(current.interests, incoming.interests, ", ");
  for (const [key, list] of Object.entries(LIST_KEYS) as Array<[ImportKey, ListKey]>) {
    if (!keys.has(key)) continue;
    const added = incoming[list] as Array<{ id: string }>;
    if (!added.length) continue;
    const kept = mode === "replace" ? [] : filledOnly(current[list] as Array<{ id: string }>);
    (next as Record<ListKey, unknown>)[list] = [...kept, ...added].slice(0, CV_LIMITS[list]);
  }
  next.hidden = current.hidden.filter((section) => !keys.has(section));
  return next;
}
