import type { Locale } from "@/types";
import type { ToolGroup, ToolShortcut } from "@/app/navigation";

function normalize(value: string, locale: Locale): string {
  return value.toLocaleLowerCase(locale).trim();
}

export function toolMatches(tool: ToolShortcut, query: string, locale: Locale, label: string, description: string, group: ToolGroup | "all"): boolean {
  if (group !== "all" && tool.group !== group) return false;
  const needle = normalize(query, locale);
  if (!needle) return true;
  return normalize(`${label} ${description} ${tool.keywords}`, locale).includes(needle);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function formatRelativeMoment(timestamp: number, locale: Locale, now: number = Date.now(), justNow?: string): string {
  const diff = timestamp - now;
  if (justNow && Math.abs(diff) < MINUTE_MS) return justNow;
  const days = Math.round(diff / DAY_MS);
  if (Math.abs(days) < 7) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (Math.abs(diff) < 60 * 60 * 1000) {
      const minutes = Math.round(diff / (60 * 1000));
      return rtf.format(minutes, "minute");
    }
    if (Math.abs(diff) < DAY_MS) {
      const hours = Math.round(diff / (60 * 60 * 1000));
      return rtf.format(hours, "hour");
    }
    return rtf.format(days, "day");
  }
  return new Date(timestamp).toLocaleDateString(locale, { dateStyle: "medium" });
}
