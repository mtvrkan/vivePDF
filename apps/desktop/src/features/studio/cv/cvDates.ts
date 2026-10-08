export type MonthYear = { month: number | null; year: number };

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const names = new Map<string, string[]>();

export function monthNames(language: string, style: "short" | "long"): string[] {
  const key = `${language}|${style}`;
  const known = names.get(key);
  if (known) return known;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(language, { month: style, timeZone: "UTC" });
  } catch {
    format = new Intl.DateTimeFormat("en", { month: style, timeZone: "UTC" });
  }
  const list = Array.from({ length: 12 }, (_, index) => format.format(Date.UTC(2020, index, 15)));
  names.set(key, list);
  return list;
}

function plain(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\.$/, "").toLocaleLowerCase();
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

export function parseMonthYear(text: string, language: string): MonthYear | null {
  const value = text.trim();
  if (/^\d{4}$/.test(value)) {
    const year = Number(value);
    return validYear(year) ? { month: null, year } : null;
  }
  const numeric = /^(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(value);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = Number(numeric[2]);
    return month >= 1 && month <= 12 && validYear(year) ? { month, year } : null;
  }
  const named = /^(\S+)\s+(\d{4})$/u.exec(value);
  if (!named) return null;
  const year = Number(named[2]);
  if (!validYear(year)) return null;
  const word = plain(named[1]);
  for (const candidate of [language, "en"]) {
    for (const style of ["short", "long"] as const) {
      const index = monthNames(candidate, style).findIndex((name) => plain(name) === word);
      if (index >= 0) return { month: index + 1, year };
    }
  }
  return null;
}

export function formatMonthYear(value: MonthYear, language: string): string {
  if (value.month === null) return String(value.year);
  return `${monthNames(language, "short")[value.month - 1]} ${value.year}`;
}
