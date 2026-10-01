export const DATE_FORMATS: readonly { value: string; label: string }[] = [
  { value: "%d.%m.%Y", label: "31.12.2026" },
  { value: "%d/%m/%Y", label: "31/12/2026" },
  { value: "%m/%d/%Y", label: "12/31/2026" },
  { value: "%Y-%m-%d", label: "2026-12-31" },
];

export const DEFAULT_DATE_FORMAT = DATE_FORMATS[0].value;

export function knownDateFormat(value: unknown): string {
  return DATE_FORMATS.some((format) => format.value === value) ? (value as string) : DEFAULT_DATE_FORMAT;
}
