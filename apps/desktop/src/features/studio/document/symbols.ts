export const SYMBOL_GROUPS = {
  punctuation: "— – … « » ‹ › „ “ ” ‘ ’ ‚ · • ‰ § ¶ † ‡ © ® ™ ° ′ ″ ¡ ¿ № ℃ ℉",
  currency: "₺ € £ $ ¥ ₹ ¢ ₽ ₩ ₪ ₫ ₴ ₦ ₱ ฿ ¤",
  math: "± × ÷ ≈ ≠ ≡ ≤ ≥ ∞ √ ∛ ∑ ∏ ∫ ∂ ∆ ∇ π µ ∈ ∉ ∩ ∪ ⊂ ⊃ ∀ ∃ ¬ ∧ ∨ ∴ ∵ ∠ ⊥ ∥ ¹ ² ³ ⁴ ⁿ ₀ ₁ ₂ ₃ ½ ⅓ ⅔ ¼ ¾ ⅛",
  arrows: "← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇔ ⇑ ⇓ ↩ ↪ ↗ ↘ ↙ ↖ ➜ ➔ ⟵ ⟶",
  greek: "α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω",
  latin: "à á â ä ã å æ ç è é ê ë ì í î ï ğ ı ñ ò ó ô ö õ ø œ ş ß ù ú û ü ý ÿ À Á Â Ä Ç É È Ê Ğ İ Ñ Ö Ø Œ Ş Ü",
  shapes: "✓ ✔ ✗ ✘ ★ ☆ ● ○ ■ □ ▲ △ ▼ ▽ ◆ ◇ ♠ ♣ ♥ ♦ ☎ ✉ ☀ ☁ ☂ ♪ ♫ ☺",
} as const;

export type SymbolGroup = keyof typeof SYMBOL_GROUPS;
export const SYMBOL_GROUP_KEYS = Object.keys(SYMBOL_GROUPS) as SymbolGroup[];
export const RECENT_LIMIT = 16;

const RECENT_KEY = "vivepdf.studio.recentSymbols";
const KNOWN = new Set(Object.values(SYMBOL_GROUPS).flatMap((group) => group.split(" ")));

export function symbolsOf(group: SymbolGroup): string[] {
  return SYMBOL_GROUPS[group].split(" ");
}

export function codePointLabel(symbol: string): string {
  return `U+${(symbol.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

export function readRecentSymbols(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string" && KNOWN.has(item)).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberSymbol(symbol: string, recent: string[]): string[] {
  const next = [symbol, ...recent.filter((item) => item !== symbol)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}
