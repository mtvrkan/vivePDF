import { applyLocale, currentLocale, LOCALE_STORAGE_KEY, readStoredLocale } from "@/app/i18n";
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY } from "@/app/theme";
import { applyPreferences, PREFERENCES_KEY, readPreferences, usePreferencesStore } from "@/shared/store/preferencesStore";
import { readRecentFiles, RECENT_STORAGE_KEY, useRecentStore } from "@/shared/store/recentStore";
import { useUiStore } from "@/shared/store/uiStore";

function touches(changed: string | null, key: string): boolean {
  return changed === null || changed === key;
}

export function applyStorageChange(changed: string | null): void {
  if (touches(changed, PREFERENCES_KEY)) {
    const preferences = readPreferences();
    applyPreferences(preferences);
    usePreferencesStore.setState(preferences);
  }
  if (touches(changed, THEME_STORAGE_KEY)) {
    const theme = readStoredTheme();
    applyTheme(theme);
    useUiStore.setState({ theme });
  }
  if (touches(changed, LOCALE_STORAGE_KEY)) {
    const locale = readStoredLocale();
    if (locale && locale !== currentLocale()) {
      void applyLocale(locale);
      useUiStore.setState({ locale });
    }
  }
  if (touches(changed, RECENT_STORAGE_KEY)) useRecentStore.setState({ items: readRecentFiles() });
}

export function followOtherWindows(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage) applyStorageChange(event.key);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
