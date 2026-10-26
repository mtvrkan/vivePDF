export type DocumentSettingsSection = "furniture" | "contents" | "cover";

export function settingsSectionId(section: DocumentSettingsSection): string {
  return `document-settings-${section}`;
}
