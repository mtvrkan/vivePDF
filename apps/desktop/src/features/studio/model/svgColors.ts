const NAMED_TABLE =
  "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd," +
  "blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed," +
  "cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9," +
  "darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f," +
  "darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff," +
  "dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc," +
  "ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c," +
  "indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080," +
  "lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a," +
  "lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00," +
  "limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db," +
  "mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970," +
  "mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500," +
  "orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9," +
  "peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1," +
  "saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
  "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0," +
  "violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32";

export type SvgColorMap = Readonly<Record<string, string>>;

type ParsedColor = { key: string; alpha: string | null; format: "hex" | "rgb" | "named" | "current" };
type Visit = (color: ParsedColor) => string | null;

const NAMED = new Map(
  NAMED_TABLE.split(",").map((pair) => {
    const [name, hex] = pair.split(":");
    return [name, `#${hex}`] as const;
  }),
);
const PROPERTY = "(?:fill|stroke|stop-color|flood-color|lighting-color|color)";
const ATTRIBUTE = new RegExp(`(\\s${PROPERTY}\\s*=\\s*)(["'])([^"'<>]*)\\2`, "gi");
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(["'])([^"'<>]*)\2/gi;
const STYLE_ELEMENT = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const DECLARATION = new RegExp(`((?:^|[\\s;{])${PROPERTY}\\s*:\\s*)([^;{}"'<>!]+)`, "gi");
const TOKEN = /url\([^)]*\)|#[0-9a-f]+\b|rgba?\([^)]*\)|[a-z][a-z-]*/gi;
const COLOR_DECLARED = /\scolor\s*=|(?:^|[\s;{"'])color\s*:/i;
const COLOR_VALUE = /\scolor\s*=\s*(["'])([^"'<>]*)\1|(?:^|[\s;{"'])color\s*:\s*([^;{}"'<>!]+)/i;
const DEFAULT_COLOR = "#000000";
const CURRENT_COLOR = /currentcolor/i;
const HEX_KEY = /^#[0-9a-f]{6}$/;
const CACHE_LIMIT = 48;
const cache = new Map<string, string[]>();

const hexByte = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");

function channel(part: string): number | null {
  const value = Number.parseFloat(part);
  if (!Number.isFinite(value)) return null;
  return part.trim().endsWith("%") ? (value / 100) * 255 : value;
}

function parseHex(token: string): ParsedColor | null {
  const digits = token.slice(1).toLowerCase();
  if (digits.length === 3 || digits.length === 4) {
    const full = [...digits].map((digit) => digit + digit).join("");
    return { key: `#${full.slice(0, 6)}`, alpha: digits.length === 4 ? full.slice(6) : null, format: "hex" };
  }
  if (digits.length === 6 || digits.length === 8) return { key: `#${digits.slice(0, 6)}`, alpha: digits.length === 8 ? digits.slice(6) : null, format: "hex" };
  return null;
}

function parseRgb(token: string): ParsedColor | null {
  const inner = token.slice(token.indexOf("(") + 1, -1).trim();
  const parts = inner.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map(channel);
  if (rgb.some((value) => value === null)) return null;
  return { key: `#${(rgb as number[]).map(hexByte).join("")}`, alpha: parts[3] ?? null, format: "rgb" };
}

function parseColor(token: string): ParsedColor | null {
  if (token.startsWith("#")) return parseHex(token);
  const lower = token.toLowerCase();
  if (lower.startsWith("rgb")) return parseRgb(token);
  const named = NAMED.get(lower);
  return named ? { key: named, alpha: null, format: "named" } : null;
}

function formatColor(hex: string, original: ParsedColor): string {
  if (original.alpha === null) return hex;
  if (original.format === "hex") return `${hex}${original.alpha}`;
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${original.alpha})`;
}

function documentColor(svg: string): string {
  const match = COLOR_VALUE.exec(svg);
  for (const token of (match?.[2] ?? match?.[3] ?? "").match(TOKEN) ?? []) {
    const parsed = parseColor(token);
    if (parsed) return parsed.key;
  }
  return DEFAULT_COLOR;
}

function rewriteValue(value: string, visit: Visit, current: string | null): string {
  return value.replace(TOKEN, (token) => {
    const lower = token.toLowerCase();
    const parsed = lower.startsWith("url(") ? null : lower === "currentcolor" ? (current ? { key: current, alpha: null, format: "current" as const } : null) : parseColor(token);
    return parsed ? (visit(parsed) ?? token) : token;
  });
}

function rewriteDeclarations(text: string, visit: Visit, current: string | null): string {
  return text.replace(DECLARATION, (_, prefix: string, value: string) => prefix + rewriteValue(value, visit, current));
}

function rewrite(svg: string, visit: Visit): string {
  const current = CURRENT_COLOR.test(svg) ? documentColor(svg) : null;
  return svg
    .replace(STYLE_ELEMENT, (_, open: string, body: string, close: string) => open + rewriteDeclarations(body, visit, current) + close)
    .replace(ATTRIBUTE, (_, prefix: string, quote: string, value: string) => prefix + quote + rewriteValue(value, visit, current) + quote)
    .replace(STYLE_ATTRIBUTE, (_, prefix: string, quote: string, value: string) => prefix + quote + rewriteDeclarations(value, visit, current) + quote);
}

export function svgColors(svg: string): string[] {
  const cached = cache.get(svg);
  if (cached) return cached;
  const found = new Set<string>();
  rewrite(svg, (color) => {
    found.add(color.key);
    return null;
  });
  const colors = [...found];
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(svg, colors);
  return colors;
}

export function recolorSvg(svg: string, map: SvgColorMap | undefined): string {
  const mapped = map !== undefined && Object.keys(map).length > 0;
  const resolveCurrent = CURRENT_COLOR.test(svg) && COLOR_DECLARED.test(svg);
  if (!mapped && !resolveCurrent) return svg;
  return rewrite(svg, (color) => {
    const target = map?.[color.key];
    if (target && target !== color.key) return formatColor(target, color);
    return color.format === "current" ? color.key : null;
  });
}

export function effectiveSvgColors(svg: string, map: SvgColorMap | undefined): string[] {
  return [...new Set(svgColors(svg).map((color) => map?.[color] ?? color))];
}

export function swapSvgColors(svg: string, map: SvgColorMap | undefined, swap: (color: string) => string): SvgColorMap | undefined {
  const next: Record<string, string> = { ...map };
  let changed = false;
  for (const original of svgColors(svg)) {
    const current = map?.[original] ?? original;
    const target = swap(current).toLowerCase();
    if (target === current || !HEX_KEY.test(target)) continue;
    changed = true;
    if (target === original) delete next[original];
    else next[original] = target;
  }
  if (!changed) return map;
  return Object.keys(next).length ? next : undefined;
}
