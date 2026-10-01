import type { ThemeMode } from "@/types";

export const THEME_STORAGE_KEY = "vivepdf.theme";

export function readStoredTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return mode === "dark";
}

export function isDarkTheme(mode: ThemeMode): boolean {
  return resolveDark(mode);
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", resolveDark(mode));
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    return;
  }
}

export function applyStoredTheme() {
  const mode = readStoredTheme();
  applyTheme(mode);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readStoredTheme() === "system") applyTheme("system");
  });
}
