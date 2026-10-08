import type { StudioFill } from "@/types/studio";

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

export function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function blend(over: string, under: string, opacity: number): string {
  const top = parseHex(over);
  const bottom = parseHex(under);
  if (!top || !bottom) return over;
  return `#${top.map((value, index) => Math.round(value * opacity + bottom[index] * (1 - opacity)).toString(16).padStart(2, "0")).join("")}`;
}

export function averageColor(fill: StudioFill): string | null {
  if (fill.type === "solid") return parseHex(fill.color) ? fill.color : null;
  if (fill.type === "none") return null;
  const parsed = fill.stops.map((stop) => parseHex(stop.color)).filter((value): value is [number, number, number] => value !== null);
  if (parsed.length === 0) return null;
  const mean = [0, 1, 2].map((index) => Math.round(parsed.reduce((sum, value) => sum + value[index], 0) / parsed.length));
  return `#${mean.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function readableOn(background: string, light = "#ffffff", dark = "#111827"): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}
