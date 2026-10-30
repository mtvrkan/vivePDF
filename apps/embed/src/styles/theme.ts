export type Theme = "light" | "dark";
export type ThemeSetting = Theme | "auto";

export function parseThemeSetting(value: string | null): ThemeSetting {
  return value === "dark" || value === "auto" ? value : "light";
}

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): Theme {
  if (setting === "auto") return prefersDark ? "dark" : "light";
  return setting;
}
