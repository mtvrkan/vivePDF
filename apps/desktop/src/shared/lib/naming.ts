export const OUTPUT_PATTERN_KEY = "vivepdf.outputPattern";
export const DEFAULT_OUTPUT_PATTERN = "{name}-{suffix}";
export const OUTPUT_PATTERN_TOKENS = ["name", "suffix", "date", "time", "year"] as const;
const MAX_NAME_LENGTH = 120;
const INVALID_CHARS = new Set(['<', '>', ':', '"', "/", "\\", "|", "?", "*"]);

export type NameValues = Partial<Record<(typeof OUTPUT_PATTERN_TOKENS)[number] | "pages" | "label" | "n", string | number>>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sanitizeFileName(value: string): string {
  let text = Array.from(value)
    .map((char) => (INVALID_CHARS.has(char) || char.charCodeAt(0) < 32 ? "-" : char))
    .join("");
  text = text.replace(/\s+/g, " ");
  text = text.replace(/(?:\s*-\s*)+/g, "-");
  text = text.replace(/(?:\s*_\s*){2,}/g, "_");
  text = text.replace(/^[\s._-]+|[\s._-]+$/g, "");
  return text.slice(0, MAX_NAME_LENGTH) || "output";
}

export function renderName(pattern: string, values: NameValues, now = new Date()): string {
  const enriched: Record<string, string | number> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    year: now.getFullYear(),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) enriched[key] = value;
  }
  const text = pattern.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (token, key: string) => (key in enriched ? String(enriched[key]) : token));
  return sanitizeFileName(text);
}

export function readOutputPattern(): string {
  try {
    const stored = localStorage.getItem(OUTPUT_PATTERN_KEY);
    return stored && stored.trim() ? stored : DEFAULT_OUTPUT_PATTERN;
  } catch {
    return DEFAULT_OUTPUT_PATTERN;
  }
}

export function storeOutputPattern(pattern: string) {
  try {
    if (pattern.trim() && pattern !== DEFAULT_OUTPUT_PATTERN) localStorage.setItem(OUTPUT_PATTERN_KEY, pattern);
    else localStorage.removeItem(OUTPUT_PATTERN_KEY);
  } catch {
    void 0;
  }
}

export function patternIsValid(pattern: string): boolean {
  return pattern.trim().length > 0 && /\{name\}|\{date\}|\{time\}/.test(pattern);
}

export function outputFileName(stem: string, suffix: string, pattern = readOutputPattern()): string {
  const rendered = renderName(patternIsValid(pattern) ? pattern : DEFAULT_OUTPUT_PATTERN, { name: stem, suffix });
  return rendered || stem;
}
