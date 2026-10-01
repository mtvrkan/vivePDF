import type { Locale, PageSize } from "@/types";

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number, locale: Locale = "en"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : 1;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${BYTE_UNITS[unit]}`;
}

export function formatNumber(value: number, locale: Locale = "en"): string {
  return value.toLocaleString(locale);
}

const POINTS_PER_MM = 72 / 25.4;

export function formatPageSize(size: PageSize): string {
  const width = Math.round(size.width / POINTS_PER_MM);
  const height = Math.round(size.height / POINTS_PER_MM);
  return `${width} × ${height} mm`;
}

export function pageSizesAreUniform(sizes: PageSize[]): boolean {
  if (sizes.length === 0) return true;
  const [first] = sizes;
  return sizes.every(
    (size) => Math.abs(size.width - first.width) < 1 && Math.abs(size.height - first.height) < 1,
  );
}

const PDF_DATE = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/;

export function parsePdfDate(value: string): Date | null {
  const match = PDF_DATE.exec(value.trim());
  if (!match) return null;
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00", zone] = match;
  let offsetMinutes = 0;
  if (zone && zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.replace(/[^\d]/g, "");
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
  }
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const date = new Date(utc - offsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPdfDate(value: string, locale: Locale = "en"): string {
  const date = parsePdfDate(value);
  if (!date) return value;
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
