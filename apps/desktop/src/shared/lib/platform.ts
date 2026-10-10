export const isMac = typeof navigator !== "undefined" && (navigator.userAgent ?? "").includes("Mac");
export const FULLSCREEN_SHORTCUT = isMac ? "⌃⌘F" : "F11";

type ModifierEvent = { ctrlKey: boolean; metaKey: boolean };
type FullscreenKeyEvent = ModifierEvent & { key: string; code?: string; altKey?: boolean };

const MODIFIERS = "Ctrl|Strg|Alt|Shift|Maj|Maiusc|Mayús|Umschalt";
const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌘", Strg: "⌘", Alt: "⌥", Shift: "⇧", Maj: "⇧", Maiusc: "⇧", Mayús: "⇧", Umschalt: "⇧" };
const MAC_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_SYMBOLS: Record<string, string> = { Enter: "↩", Eingabe: "↩", Entrée: "↩", Intro: "↩", Invio: "↩", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const CHIP_END = /^\s*(?:$|[/·])/;
const FUNCTION_KEY = /^F\d{1,2}$/;
const NAMED_KEYS = new Set(["Tab", "Esc", "Escape", "Space", "Delete", "Del", "Backspace", "Home", "End", "PageUp", "PageDown", "Click", "Drag", "Resize", "Rotate", "Wheel"]);
const MODIFIER_RUN = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:(?:${MODIFIERS})(?:\\s*\\+\\s*|\\s+))+)(?!(?:${MODIFIERS})(?![\\p{L}\\p{N}]))(\\{\\w+\\}|\\p{L}[\\p{L}\\p{N}]+|[A-Za-z0-9=+\\-−<>↑↓←→↵,.\\[\\];'\`](?![\\p{L}\\p{N}]))`,
  "gu",
);
const STANDALONE_CTRL = /(?<![\p{L}\p{N}])(?:Ctrl|Strg)(?![\p{L}\p{N}])/gu;
const ARIA_CONTROL = /(?<![A-Za-z])Control(?![A-Za-z])/g;

export function shortcutLabel(text: string, mac = isMac): string {
  if (!mac) return text;
  return text
    .replace(MODIFIER_RUN, (match, run: string, key: string, offset: number, whole: string) => {
      const mods = new Set((run.match(new RegExp(MODIFIERS, "gu")) ?? []).map((name) => MAC_SYMBOLS[name]));
      const symbol = KEY_SYMBOLS[key];
      const single = [...key].length === 1 || FUNCTION_KEY.test(key);
      if (!mods.has("⌘") && !single && !symbol && !NAMED_KEYS.has(key)) return match;
      if (!mods.has("⌘") && !run.includes("+") && !CHIP_END.test(whole.slice(offset + match.length))) return match;
      return MAC_ORDER.filter((mod) => mods.has(mod)).join("") + (symbol ?? (single ? key : ` ${key}`));
    })
    .replace(STANDALONE_CTRL, "⌘");
}

export function ariaShortcut(keys: string, mac = isMac): string {
  return mac ? keys.replace(ARIA_CONTROL, "Meta") : keys;
}

export function hasModKey(event: ModifierEvent, mac = isMac): boolean {
  return event.ctrlKey || (mac && event.metaKey);
}

export function isFullscreenKey(event: FullscreenKeyEvent, mac = isMac): boolean {
  if (event.key === "F11") return true;
  return mac && event.ctrlKey && event.metaKey && !event.altKey && (event.key.toLowerCase() === "f" || event.code === "KeyF");
}
