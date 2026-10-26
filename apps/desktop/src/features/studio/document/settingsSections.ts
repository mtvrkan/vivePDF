export type DocumentSettingsSection = "page" | "furniture" | "contents" | "cover";

export function settingsSectionId(section: DocumentSettingsSection): string {
  return `document-settings-${section}`;
}
