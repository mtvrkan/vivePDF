import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { escapeXml } from "../seo/xml";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const PALETTE = {
  wash: "#EAF2FB",
  washTwo: "#F4F8FD",
  deep: "#0A1A33",
  inkTwo: "#34496A",
  inkThree: "#53678A",
  blueInk: "#1A62B0",
  blue: "#2F8FE6",
  sky: "#7FD0FF",
  amber: "#FFC46B",
  line: "#DCE5F0",
};

const SIDE = 72;
const TEXT_WIDTH = CARD_WIDTH - SIDE * 2;
const fontFiles = ["Geist-Bold.ttf", "Geist-Regular.ttf", "GeistMono-Medium.ttf"].map((f) => resolve("src/og/fonts", f));
const icon = `data:image/png;base64,${readFileSync(resolve("public/icon-256.png")).toString("base64")}`;

export type Card = { lang: string; eyebrow: string; title: string; description: string; address: string };

export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+$/, "")}…`;
  return kept;
}

function titleLayout(title: string): { size: number; lines: string[] } {
  for (const size of [84, 72, 62]) {
    const lines = wrapLines(title, Math.floor(TEXT_WIDTH / (size * 0.56)), 3);
    if (!lines[lines.length - 1].endsWith("…") && lines.length <= (size > 72 ? 2 : 3)) return { size, lines };
  }
  return { size: 62, lines: wrapLines(title, Math.floor(TEXT_WIDTH / (62 * 0.56)), 3) };
}

function tspans(lines: string[], x: number, lineHeight: number): string {
  return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(l)}</tspan>`).join("");
}

export function cardSvg(card: Card): string {
  const title = titleLayout(card.title);
  const titleLine = Math.round(title.size * 1.06);
  const eyebrowY = 196;
  const titleTop = eyebrowY + 30 + Math.round(title.size * 0.92);
  const titleBottom = titleTop + titleLine * (title.lines.length - 1);
  const descriptionTop = titleBottom + 70;
  const descriptionLines = Math.max(1, Math.min(3, Math.floor((516 - descriptionTop) / 42) + 1));
  const description = wrapLines(card.description, 66, descriptionLines);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${PALETTE.washTwo}"/><stop offset="1" stop-color="${PALETTE.wash}"/></linearGradient>
<radialGradient id="sky" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${PALETTE.sky}" stop-opacity="0.55"/><stop offset="1" stop-color="${PALETTE.sky}" stop-opacity="0"/></radialGradient>
<radialGradient id="amber" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${PALETTE.amber}" stop-opacity="0.4"/><stop offset="1" stop-color="${PALETTE.amber}" stop-opacity="0"/></radialGradient>
<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PALETTE.blue}"/><stop offset="1" stop-color="${PALETTE.sky}"/></linearGradient>
<clipPath id="logo"><rect x="${SIDE}" y="56" width="60" height="60" rx="14"/></clipPath>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>
<circle cx="1060" cy="90" r="360" fill="url(#sky)"/>
<circle cx="1120" cy="600" r="300" fill="url(#amber)"/>
<image x="${SIDE}" y="56" width="60" height="60" href="${icon}" xlink:href="${icon}" clip-path="url(#logo)"/>
<text x="${SIDE + 78}" y="97" font-family="Geist" font-weight="700" font-size="32" fill="${PALETTE.deep}">vivePDF</text>
<rect x="${SIDE}" y="${eyebrowY - 8}" width="40" height="3" rx="1.5" fill="url(#rule)"/>
<text x="${SIDE + 56}" y="${eyebrowY}" font-family="Geist Mono" font-weight="500" font-size="22" letter-spacing="2" fill="${PALETTE.blueInk}">${escapeXml(card.eyebrow.toLocaleUpperCase(card.lang))}</text>
<text x="${SIDE}" y="${titleTop}" font-family="Geist" font-weight="700" font-size="${title.size}" letter-spacing="${-title.size * 0.03}" fill="${PALETTE.deep}">${tspans(title.lines, SIDE, titleLine)}</text>
<text x="${SIDE}" y="${descriptionTop}" font-family="Geist" font-weight="400" font-size="30" fill="${PALETTE.inkTwo}">${tspans(description, SIDE, 42)}</text>
<line x1="${SIDE}" y1="548" x2="${CARD_WIDTH - SIDE}" y2="548" stroke="${PALETTE.line}" stroke-width="2"/>
<text x="${SIDE}" y="590" font-family="Geist Mono" font-weight="500" font-size="22" fill="${PALETTE.inkThree}">${escapeXml(card.address)}</text>
</svg>`;
}

export function cardPng(card: Card): ArrayBuffer {
  const resvg = new Resvg(cardSvg(card), {
    fitTo: { mode: "width", value: CARD_WIDTH },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Geist" },
  });
  const png = resvg.render().asPng();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
