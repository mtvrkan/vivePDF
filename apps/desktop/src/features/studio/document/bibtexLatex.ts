const ACCENTS: Record<string, string> = {
  '"': "̈",
  "'": "́",
  "`": "̀",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  c: "̧",
  H: "̋",
  k: "̨",
  r: "̊",
  d: "̣",
  b: "̱",
};
const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};
const SYMBOLS: Record<string, string> = {
  ...GREEK,
  i: "ı",
  j: "ȷ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  dh: "ð",
  DH: "Ð",
  th: "þ",
  TH: "Þ",
  ng: "ŋ",
  NG: "Ŋ",
  textendash: "–",
  textemdash: "—",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  textquotesingle: "'",
  textquotedbl: '"',
  guillemotleft: "«",
  guillemotright: "»",
  textsection: "§",
  S: "§",
  P: "¶",
  dag: "†",
  ddag: "‡",
  textdagger: "†",
  textbullet: "•",
  textperiodcentered: "·",
  copyright: "©",
  textcopyright: "©",
  textregistered: "®",
  texttrademark: "™",
  textdegree: "°",
  degree: "°",
  textmu: "µ",
  textonehalf: "½",
  textonequarter: "¼",
  textthreequarters: "¾",
  texttimes: "×",
  times: "×",
  textdiv: "÷",
  div: "÷",
  pm: "±",
  textpm: "±",
  mp: "∓",
  cdot: "·",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  sqrt: "√",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  leftrightarrow: "↔",
  ell: "ℓ",
  hbar: "ℏ",
  prime: "′",
  circ: "∘",
  textless: "<",
  textgreater: ">",
  textbar: "|",
  textasciicircum: "^",
  textunderscore: "_",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  textellipsis: "…",
  euro: "€",
  texteuro: "€",
  pounds: "£",
  textsterling: "£",
  LaTeX: "LaTeX",
  TeX: "TeX",
  BibTeX: "BibTeX",
  textbackslash: "\\",
  textasciitilde: "~",
  slash: "/",
  quad: " ",
  qquad: " ",
};
const SUPERSCRIPTS: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUBSCRIPTS: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" };
const ESCAPED = new Set(["&", "%", "$", "#", "_", "{", "}"]);
const SPACING = new Set([" ", ",", ";", ":", ">"]);
const DOTLESS: Record<string, string> = { ı: "i", ȷ: "j" };
const VERBATIM_COMMANDS = new Set(["url", "path", "nolinkurl"]);

export function groupEnd(raw: string, open: number): number {
  let depth = 0;
  for (let index = open; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function argument(raw: string, start: number): { text: string; end: number } | null {
  let index = start;
  while (raw[index] === " ") index += 1;
  if (raw[index] !== "{") return null;
  const close = groupEnd(raw, index);
  return close < 0 ? null : { text: raw.slice(index + 1, close), end: close + 1 };
}

function accentBase(raw: string, start: number): [string, number] {
  let index = start;
  while (raw[index] === " ") index += 1;
  if (raw[index] === "{") {
    const close = groupEnd(raw, index);
    if (close < 0) return ["", raw.length];
    return [decodeLatex(raw.slice(index + 1, close)), close + 1];
  }
  if (raw[index] === "\\") {
    const match = /^\\[A-Za-z]+/.exec(raw.slice(index));
    if (match) return [decodeLatex(match[0]), index + match[0].length];
  }
  return [raw[index] ?? "", index + 1];
}

function accented(mark: string, base: string): string {
  if (!base) return "";
  const first = Array.from(base)[0];
  return `${DOTLESS[first] ?? first}${ACCENTS[mark]}${base.slice(first.length)}`;
}

function scripted(text: string, table: Record<string, string>, mark: string): string {
  const characters = Array.from(text);
  return characters.every((character) => table[character]) ? characters.map((character) => table[character]).join("") : `${mark}${text}`;
}

function scriptAt(raw: string, index: number, inMath: boolean): { text: string; end: number } | null {
  const char = raw[index];
  if (!inMath || (char !== "^" && char !== "_")) return null;
  const table = char === "^" ? SUPERSCRIPTS : SUBSCRIPTS;
  const group = argument(raw, index + 1);
  if (group) return { text: scripted(decodeLatex(group.text), table, char), end: group.end };
  const single = raw[index + 1];
  if (single === undefined || single === "\\") return null;
  return { text: scripted(single, table, char), end: index + 2 };
}

function commandAt(raw: string, index: number): { text: string; end: number } {
  const next = raw[index + 1] ?? "";
  if (ESCAPED.has(next)) return { text: next, end: index + 2 };
  if (next === "\\" || SPACING.has(next)) return { text: " ", end: index + 2 };
  if (next === "-" || next === "/" || next === "!" || next === "@") return { text: "", end: index + 2 };
  if (next in ACCENTS && !/[A-Za-z]/.test(next)) {
    const [base, end] = accentBase(raw, index + 2);
    return { text: accented(next, base), end };
  }
  const name = /^[A-Za-z]+/.exec(raw.slice(index + 1))?.[0];
  if (!name) return { text: "", end: index + 1 };
  let end = index + 1 + name.length;
  if (name.length === 1 && name in ACCENTS) {
    const [base, after] = accentBase(raw, end);
    return { text: accented(name, base), end: after };
  }
  if (VERBATIM_COMMANDS.has(name)) {
    const group = argument(raw, end);
    if (group) return { text: group.text, end: group.end };
  }
  if (name === "href") {
    const target = argument(raw, end);
    const label = target ? argument(raw, target.end) : null;
    if (target && label) return { text: decodeLatex(label.text) || target.text, end: label.end };
  }
  if (Object.hasOwn(SYMBOLS, name)) {
    if (raw.startsWith("{}", end)) end += 2;
    else if (raw[end] === " ") end += 1;
    return { text: SYMBOLS[name], end };
  }
  let probe = end;
  while (raw[probe] === " ") probe += 1;
  if (raw[probe] === "{") return { text: "", end: probe };
  return { text: `\\${name}`, end };
}

export function decodeLatex(raw: string): string {
  let out = "";
  let index = 0;
  let inMath = false;
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      const command = commandAt(raw, index);
      out += command.text;
      index = command.end;
      continue;
    }
    const script = scriptAt(raw, index, inMath);
    if (script) {
      out += script.text;
      index = script.end;
    } else if (char === "$") {
      inMath = !inMath;
      index += 1;
    } else if (char === "{" || char === "}") {
      index += 1;
    } else if (char === "~") {
      out += " ";
      index += 1;
    } else if (raw.startsWith("---", index)) {
      out += "—";
      index += 3;
    } else if (raw.startsWith("--", index)) {
      out += "–";
      index += 2;
    } else if (raw.startsWith("``", index)) {
      out += "“";
      index += 2;
    } else if (raw.startsWith("''", index)) {
      out += "”";
      index += 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim().normalize("NFC");
}
