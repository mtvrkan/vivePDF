export type Rgb = { r: number; g: number; b: number };
export type Hsv = { h: number; s: number; v: number };

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHex(value: string, fallback = "#000000"): string {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return fallback;
  const digits = match[1].toLowerCase();
  const full = digits.length === 3 ? digits.replace(/./g, (character) => character + character) : digits;
  return `#${full}`;
}

export function isValidHex(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

export function hexToRgb(value: string): Rgb {
  const hex = normalizeHex(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (channel: number) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
    else if (max === green) hue = ((blue - red) / delta + 2) * 60;
    else hue = ((red - green) / delta + 4) * 60;
  }
  return { h: Math.round(hue), s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 1);
  const value = clamp(v, 0, 1);
  const chroma = value * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = value - chroma;
  const sector = Math.floor(hue / 60) % 6;
  const table: Array<[number, number, number]> = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [r, g, b] = table[sector];
  return { r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255 };
}

export function hexToHsv(value: string): Hsv {
  return rgbToHsv(hexToRgb(value));
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

export function isLightColor(value: string): boolean {
  const { r, g, b } = hexToRgb(value);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
