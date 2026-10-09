import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const TONES = ["organize", "improve", "toPdf", "fromPdf", "edit", "security"];

function darkBlock(): string {
  const start = css.indexOf(".dark {");
  return css.slice(start, css.indexOf("}", start));
}

function darkToken(name: string): [number, number, number] {
  const match = darkBlock().match(new RegExp(`--${name}:\\s*hsl\\(([\\d.]+) ([\\d.]+)% ([\\d.]+)%\\);`));
  if (!match) throw new Error(`no dark token ${name}`);
  const [hue, saturation, lightness] = match.slice(1).map(Number);
  const chroma = (1 - Math.abs((2 * lightness) / 100 - 1)) * (saturation / 100);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return lightness / 100 - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(first: [number, number, number], second: [number, number, number]): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function alphaOf(block: string, name: string): number {
  return Number(block.match(new RegExp(`--${name}:\\s*hsl\\([^/]+/\\s*([\\d.]+)\\);`))?.[1]);
}

describe("globals.css", () => {
  it("leaves the -webkit- backdrop prefix to the CSS minifier", () => {
    expect(css).not.toMatch(/-webkit-backdrop-filter\s*:/);
  });

  it("keeps the blur on the glass surfaces", () => {
    for (const selector of [".glass-flat", ".glass-chip", ".glass-menu", ".glass"]) {
      const block = css.slice(css.indexOf(`  ${selector} {`));
      expect(block.slice(0, block.indexOf("}")), selector).toMatch(/backdrop-filter:\s*blur\(/);
    }
  });

  it("keeps dark theme text readable without full white on black glare", () => {
    const pairs: [string, string][] = [
      ["foreground", "background"],
      ["foreground", "card"],
      ["muted-foreground", "card"],
      ["muted-foreground", "secondary"],
      ["primary", "card"],
      ["primary-foreground", "primary"],
      ["destructive", "secondary"],
      ...TONES.map((tone): [string, string] => [`tone-${tone}`, "card"]),
    ];

    for (const [text, surface] of pairs) expect(contrast(darkToken(text), darkToken(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkToken("foreground"), darkToken("background"))).toBeLessThan(16);
  });

  it("keeps the dark theme washes and glows soft", () => {
    for (const name of ["ambient-a", "ambient-b", "ambient-c"]) expect(alphaOf(darkBlock(), name), name).toBeLessThanOrEqual(0.15);
    expect(Number(darkBlock().match(/--aurora-opacity:\s*([\d.]+);/)?.[1])).toBeLessThanOrEqual(0.5);
    expect(Number(darkBlock().match(/--blob-strength:\s*([\d.]+)%;/)?.[1])).toBeLessThanOrEqual(12);
  });

  it("paints menus and toolbars that float over pages fully opaque", () => {
    const block = css.slice(css.indexOf("  .glass-menu {"));
    expect(block.slice(0, block.indexOf("}"))).toMatch(/background:\s*var\(--color-card\);/);
  });
});
