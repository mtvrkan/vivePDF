import { defaultOcrLanguages } from "@/app/locales";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useUiStore } from "@/shared/store/uiStore";

export function preferredOcrLanguages(): string[] {
  const languages = usePreferencesStore.getState().ocrLanguage.trim();
  return languages ? languages.split(/[,+\s]+/).filter(Boolean) : defaultOcrLanguages(useUiStore.getState().locale);
}
