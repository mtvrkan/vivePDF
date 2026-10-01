export function localeDisplayName(code: string, uiLocale: string): string {
  const tag = code.replace("_", "-");
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(tag) ?? code;
  } catch {
    return code;
  }
}
