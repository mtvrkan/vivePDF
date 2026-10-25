import { compareVersions } from "@/shared/lib/lastSeenVersion";

export type ReleaseNote = { version: string; items: string[] };

export const RELEASE_NOTES: ReleaseNote[] = [
  { version: "0.5.0", items: ["sources", "conversions", "printPreview", "defaultApp", "newTools", "officeAndImages"] },
  { version: "0.4.0", items: ["officeFiles", "tabWindows", "macos", "presentationBoards", "smoother"] },
  { version: "0.3.0", items: ["helpAndSupport", "offlineMode", "presenterView", "studioWriting", "presentationInsert"] },
  { version: "0.2.0", items: ["templates", "cvImport", "organizer", "viewerEditing", "collections"] },
  { version: "0.1.1", items: ["studio", "cvBuilder", "studioTools", "fontLibrary", "iconLibrary"] },
];

export function releaseKey(version: string): string {
  return `v${version.replace(/\./g, "_")}`;
}

export function notesUpTo(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  return notes.filter((note) => compareVersions(note.version, current) <= 0).sort((a, b) => compareVersions(b.version, a.version));
}
