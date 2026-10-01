import { applyLocale, preferredLocale } from "@/app/i18n";
import { isDarkTheme, readStoredTheme } from "@/app/theme";
import { storedKeys } from "@/shared/lib/retiredSettings";
import { readOutputPattern } from "@/shared/lib/naming";
import { usePaletteStore, readRecentIds } from "@/shared/store/paletteStore";
import { applyPreferences, readPreferences, usePreferencesStore } from "@/shared/store/preferencesStore";
import { readPrefs, usePresentationStore } from "@/shared/store/presentationStore";
import { readStored as readScanProfiles, useScanProfilesStore } from "@/shared/store/scanProfilesStore";
import { readStored as readReading, useReadingStore } from "@/shared/store/readingStore";
import { readStored as readSignatures, useSignatureStore } from "@/shared/store/signatureStore";
import { readStoredVolume, useSpeechStore } from "@/shared/store/speechStore";
import { readStored as readTranslationPair, useTranslationStore } from "@/shared/store/translationStore";
import { readStoredZoom, useUiStore } from "@/shared/store/uiStore";
import { readAutoCheck, useUpdateStore } from "@/shared/store/updateStore";
import { readStored as readViewerPanels, useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { readStoredPause, readStored as readWatchRules, useWatchStore } from "@/shared/store/watchStore";
import { readStored as readWebSearch, useWebSearchStore } from "@/shared/store/webSearchStore";

const SETTINGS_PREFIX = "vivepdf.";
export const HISTORY_KEYS: readonly string[] = ["vivepdf.recent", "vivepdf.history", "vivepdf.session", "vivepdf.searchHistory"];
export const USER_DATA_KEYS: readonly string[] = ["vivepdf.signatures", "vivepdf.batchChains", "vivepdf.watchRules", "vivepdf.markPresets.v1", "vivepdf.scanProfiles"];
export const RUN_STATE_KEYS: readonly string[] = ["vivepdf.cleanExit", "vivepdf.startupOffered"];

export function keysKeptOnReset(deleteUserData: boolean): ReadonlySet<string> {
  return new Set([...HISTORY_KEYS, ...RUN_STATE_KEYS, ...(deleteUserData ? [] : USER_DATA_KEYS)]);
}

function applyThemeClass(theme: ReturnType<typeof readStoredTheme>): void {
  if (typeof document === "undefined" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  document.documentElement.classList.toggle("dark", isDarkTheme(theme));
}

export function reloadStoredSettings(): Promise<void> {
  const preferences = readPreferences();
  usePreferencesStore.setState(preferences);
  applyPreferences(preferences);
  const theme = readStoredTheme();
  applyThemeClass(theme);
  const locale = preferredLocale();
  useUiStore.setState({ theme, locale, pagesZoom: readStoredZoom(), outputPattern: readOutputPattern() });
  useReadingStore.setState(readReading());
  useSpeechStore.setState({ volume: readStoredVolume() });
  usePresentationStore.setState({ ...readPrefs() });
  useViewerPanelsStore.setState({ panels: readViewerPanels() });
  useWebSearchStore.setState(readWebSearch());
  useTranslationStore.setState(readTranslationPair());
  useUpdateStore.setState({ autoCheck: readAutoCheck() });
  usePaletteStore.setState({ recentIds: readRecentIds() });
  useSignatureStore.setState({ items: readSignatures() });
  useWatchStore.setState({ rules: readWatchRules(), pausedAt: readStoredPause() });
  useScanProfilesStore.setState({ profiles: readScanProfiles() });
  return applyLocale(locale).catch(() => undefined);
}

export function resetStoredSettings(keep: ReadonlySet<string>): boolean {
  try {
    storedKeys()
      .filter((key) => key.startsWith(SETTINGS_PREFIX) && !keep.has(key))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    return false;
  }
  void reloadStoredSettings();
  return true;
}
