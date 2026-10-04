type KeyLike = { key: string; code: string };

export type ZoomKey = "in" | "out" | "zero";

const DOTLESS_I = new Set(["ı", "İ", "I"]);

function isAsciiPrintable(key: string): boolean {
  return key.length === 1 && key >= " " && key <= "~";
}

export function shortcutLetter(event: KeyLike): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (DOTLESS_I.has(event.key)) return "i";
  const physical = /^Key([A-Z])$/.exec(event.code);
  if (physical && !isAsciiPrintable(event.key)) return physical[1].toLowerCase();
  return null;
}

export function zoomKey(event: KeyLike): ZoomKey | null {
  if (event.key === "+" || event.key === "=") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "zero";
  if (isAsciiPrintable(event.key)) return null;
  if (event.code === "Equal" || event.code === "NumpadAdd") return "in";
  if (event.code === "Minus" || event.code === "NumpadSubtract") return "out";
  if (event.code === "Digit0" || event.code === "Numpad0") return "zero";
  return null;
}

export function bracketKey(event: KeyLike & { altKey: boolean }): "left" | "right" | null {
  if (event.altKey) return null;
  if (event.key === "]" || event.key === "}" || event.code === "BracketRight") return "right";
  if (event.key === "[" || event.key === "{" || event.code === "BracketLeft") return "left";
  return null;
}

export function digitKey(event: KeyLike): number | null {
  if (/^[0-9]$/.test(event.key)) return Number(event.key);
  const physical = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  return physical ? Number(physical[1]) : null;
}
