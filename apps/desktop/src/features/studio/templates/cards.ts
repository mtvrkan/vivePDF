import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, FONTS, foil, frame, gradient, pageOf, photoSlot, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const CARD = "a5" as const;
const SHEET = "a4" as const;
const GREETING: TemplateSize = { width: 504, height: 360 };
const BUSINESS = "businessCard" as const;
const BADGE: TemplateSize = { width: 216, height: 306 };
const TABLE: TemplateSize = { width: 360, height: 252 };

const CONTACT_KEYS = ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website", "studio.tpl.address"];

function contactLines(t: TemplateContext["t"], x: number, y: number, width: number, color: string, font: string, accent: string, rows = CONTACT_KEYS): StudioElement[] {
  return rows.flatMap((key, index) => [
    box("ellipse", x, y + index * 16 + 5, 4, 4, solid(accent)),
    text(x + 10, y + index * 16, width - 10, 14, t(key), { font, size: 7.5, color, valign: "middle", shrink: true }),
  ]);
}

function thankYou({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const palette = PALETTES.blushRose;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  const sprig = { primary: palette.accent, secondary: palette.accent2 };
  return design(t("studio.templates.items.thankYou"), paletteList(palette), [
    pageOf(CARD, radial(palette.paper, palette.soft, { cy: 0.42, radius: 0.95 }), [
      art("blob", { primary: lighter(palette.accent, 0.72), secondary: palette.soft }, -70, -60, 230, 210, { opacity: 0.55 }),
      art("blob", { primary: lighter(palette.accent2, 0.6), secondary: palette.soft }, page.width - 170, page.height - 200, 240, 240, { opacity: 0.55, rotation: 160 }),
      frame("nouveauFrame", colours, page),
      art("botanicalSprig", sprig, page.width / 2 - 52, 104, 44, 88, { rotation: -28, opacity: 0.9 }),
      art("botanicalSprig", sprig, page.width / 2 + 8, 104, 44, 88, { rotation: 28, opacity: 0.9 }),
      centredText(page, 196, 112, t("studio.tpl.thankYou"), { font: FONTS.allura, size: 74, color: darker(palette.accent, 0.12), shrink: true, valign: "middle", inset: 48 }),
      art("flourishDivider", colours, page.width / 2 - 80, 314, 160, 22),
      centredText(page, 352, 80, t("studio.tpl.thankYouBody"), { font: FONTS.cormorant, size: 16, italic: true, color: palette.muted, lineHeight: 1.45, shrink: true, inset: 72 }),
      centredText(page, 440, 40, t("studio.tpl.fromName"), { font: FONTS.allura, size: 30, color: darker(palette.accent, 0.12), shrink: true, valign: "middle", inset: 72 }),
      shadowed(art("waxSeal", { primary: palette.accent, secondary: palette.accent2 }, page.width / 2 - 22, 500, 44, 44), "soft"),
    ]),
  ]);
}

function congrats({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const night = "#0f1730";
  const gold = "#d6b25e";
  const pink = "#f0a6c0";
  const ivory = "#f8f1df";
  return design(t("studio.templates.items.congrats"), [night, gold, pink, ivory], [
    pageOf(CARD, radial("#26355f", night, { cy: 0.3, radius: 1 }), [
      art("sunburst", { primary: "#33457a", secondary: gold }, 0, 0, page.width, page.height, { opacity: 0.1 }),
      art("confetti", { primary: gold, secondary: pink }, 30, 30, page.width - 60, 250, { opacity: 0.75 }),
      frame("decoFrame", { primary: gold, secondary: gold }, page),
      shadowed(art("ribbonSeal", { primary: "#b8893b", secondary: "#fff3cf" }, page.width / 2 - 52, 92, 104, 130), "lifted"),
      centredText(page, 252, 100, t("studio.tpl.congratulations"), { font: FONTS.abril, size: 40, color: "#ffffff", lineHeight: 1.08, shrink: true, valign: "middle", inset: 44 }),
      art("diamondDivider", { primary: gold, secondary: gold }, page.width / 2 - 80, 364, 160, 12),
      centredText(page, 390, 76, t("studio.tpl.congratsBody"), { font: FONTS.raleway, size: 13, color: "#d5dbe8", lineHeight: 1.55, shrink: true, inset: 64 }),
      centredText(page, 484, 20, t("studio.tpl.fromName"), { font: FONTS.raleway, size: 11, bold: true, color: gold, spacing: 3, upper: true, shrink: true, inset: 64 }),
    ]),
  ]);
}

function businessClassic({ t }: TemplateContext) {
  const page = sizeOf(BUSINESS);
  const navy = "#0f172a";
  const gold = "#b8893b";
  const ivory = "#f8f1df";
  const goldInk = darker(gold, 0.42);
  return design(t("studio.templates.items.businessCardClassic"), [navy, gold, ivory, "#fffdf8"], [
    pageOf(BUSINESS, radial("#fffdf8", "#f2eadb", { cy: 0.4, radius: 1 }), [
      box("rect", 9, 9, page.width - 18, page.height - 18, { type: "none" }, { stroke: stroke(gold, 0.8) }),
      box("rect", 12.5, 12.5, page.width - 25, page.height - 25, { type: "none" }, { stroke: stroke(gold, 0.35) }),
      art("laurel", { primary: gold, secondary: gold }, page.width / 2 - 15, 20, 30, 28),
      centredText(page, 52, 24, t("studio.tpl.personName"), { font: FONTS.cormorant, size: 18, bold: true, color: navy, shrink: true, valign: "middle", inset: 20 }),
      box("rect", page.width / 2 - 18, 81, 36, 1.2, foil("gold", 0)),
      centredText(page, 88, 12, t("studio.tpl.jobTitle"), { font: FONTS.cormorant, size: 8, bold: true, color: goldInk, spacing: 2.2, upper: true, shrink: true, inset: 22 }),
      centredText(page, 104, 14, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 9.5, italic: true, color: "#4b5563", shrink: true, inset: 22 }),
    ]),
    pageOf(BUSINESS, radial("#1d2a48", navy, { cx: 0.3, cy: 0.4, radius: 1.1 }), [
      art("topographic", { primary: "#33457a", secondary: gold }, 0, 0, page.width, page.height, { opacity: 0.3 }),
      box("rect", 0, 0, page.width, 3, foil("gold", 0)),
      text(20, 18, 140, 22, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 14, bold: true, color: ivory, valign: "middle", shrink: true }),
      box("rect", 20, 46, 28, 1.2, foil("gold", 0)),
      ...contactLines(t, 20, 58, 146, "#e5e7eb", FONTS.inter, gold),
      shadowed(box("rect", page.width - 88, 34, 70, 70, solid("#ffffff"), { radius: 8 }), "soft", "#000000"),
      qr("https://example.com", page.width - 82, 40, 58, navy),
    ]),
  ]);
}

function businessModern({ t }: TemplateContext) {
  const page = sizeOf(BUSINESS);
  const teal = "#0f766e";
  const deep = "#123f3b";
  const lime = "#a3e635";
  const mint = "#5eead4";
  const panel = 80;
  const left = panel + 16;
  return design(t("studio.templates.items.businessCardModern"), [teal, deep, lime, mint], [
    pageOf(BUSINESS, gradient(160, ["#ffffff", "#f1f7f6"]), [
      box("rect", 0, 0, panel, page.height, gradient(160, [teal, deep])),
      art("honeycomb", { primary: "#ffffff", secondary: mint }, 0, 0, panel, page.height, { opacity: 0.22 }),
      art("arcRings", { primary: lime, secondary: mint }, panel / 2 - 28, page.height / 2 - 28, 56, 56),
      box("rect", panel, 0, 3, page.height, gradient(180, [lime, mint])),
      text(left, 20, page.width - left - 14, 22, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 15, bold: true, color: "#0f172a", valign: "middle", shrink: true }),
      text(left, 44, page.width - left - 14, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 7, bold: true, color: teal, spacing: 1.6, upper: true, shrink: true }),
      rule(left, 66, 26, lime, 2.5),
      ...contactLines(t, left, 78, page.width - left - 14, "#334155", FONTS.inter, teal, ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.address"]),
    ]),
    pageOf(BUSINESS, gradient(135, [teal, deep]), [
      art("diagonalHatch", { primary: "#ffffff", secondary: mint }, 0, 0, page.width, page.height, { opacity: 0.12 }),
      art("blob", { primary: lime, secondary: mint }, page.width - 110, -44, 150, 150, { opacity: 0.3 }),
      centredText(page, 46, 26, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 17, bold: true, color: "#ffffff", spacing: 1, valign: "middle", shrink: true, inset: 22 }),
      box("rect", page.width / 2 - 12, 80, 24, 2.5, solid(lime)),
      centredText(page, 90, 14, t("studio.tpl.website"), { font: FONTS.montserrat, size: 8, color: lime, spacing: 1.5, shrink: true, inset: 22 }),
    ]),
  ]);
}

function nameBadge({ t }: TemplateContext) {
  const page = sizeOf(BADGE);
  const indigo = "#3730a3";
  const violet = "#6d28d9";
  const amber = "#f59e0b";
  const header = 104;
  return design(t("studio.templates.items.nameBadge"), [indigo, violet, amber, "#ffffff"], [
    pageOf(BADGE, gradient(180, ["#ffffff", "#f5f3ff"]), [
      box("rect", 0, 0, page.width, header, gradient(135, [indigo, violet])),
      art("halftone", { primary: "#ffffff", secondary: amber }, 0, 0, page.width, header, { opacity: 0.3 }),
      art("waves", { primary: "#ffffff", secondary: amber }, 0, header - 30, page.width, 30, { opacity: 0.28 }),
      box("rect", page.width / 2 - 18, 12, 36, 7, solid("#ffffff"), { radius: 3.5, opacity: 0.9 }),
      centredText(page, 28, 30, t("studio.tpl.eventName"), { font: FONTS.montserrat, size: 11, bold: true, color: "#ffffff", spacing: 1.5, upper: true, valign: "middle", shrink: true, inset: 16 }),
      shadowed(box("ellipse", page.width / 2 - 46, 62, 92, 92, solid("#ffffff")), "soft"),
      ...photoSlot(page.width / 2 - 40, 68, 80, 80, "#e0e7ff", "circle"),
      centredText(page, 164, 44, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 19, bold: true, color: "#111827", lineHeight: 1.1, valign: "middle", shrink: true, inset: 14 }),
      box("rect", page.width / 2 - 14, 214, 28, 2.5, solid(amber), { radius: 1.25 }),
      centredText(page, 224, 16, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 10, bold: true, color: indigo, valign: "middle", shrink: true, inset: 14 }),
      centredText(page, 242, 14, t("studio.tpl.companyName"), { font: FONTS.inter, size: 9, color: "#4b5563", valign: "middle", shrink: true, inset: 14 }),
      box("rect", 0, page.height - 30, page.width, 30, gradient(90, [amber, "#fbbf24"])),
      centredText(page, page.height - 30, 30, t("studio.tpl.attendee"), { font: FONTS.montserrat, size: 9, bold: true, color: "#1f1300", spacing: 3.5, upper: true, valign: "middle", shrink: true }),
    ]),
  ]);
}

function tableCard({ t }: TemplateContext) {
  const page = sizeOf(TABLE);
  const palette = PALETTES.sageLinen;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  return design(t("studio.templates.items.tableCard"), paletteList(palette), [
    pageOf(TABLE, radial(palette.paper, palette.soft, { cy: 0.45, radius: 0.95 }), [
      frame("gemFrame", colours, page),
      art("botanicalSprig", colours, 74, 64, 40, 80, { rotation: -22, opacity: 0.9 }),
      art("botanicalSprig", colours, page.width - 114, 64, 40, 80, { rotation: 22, opacity: 0.9 }),
      centredText(page, 40, 20, t("studio.tpl.table"), { font: FONTS.cormorant, size: 13, bold: true, color: darker(palette.accent2, 0.5), spacing: 7, upper: true, shrink: true, inset: 90 }),
      centredText(page, 62, 100, "{n}", { font: FONTS.greatVibes, size: 84, color: darker(palette.accent, 0.35), valign: "middle", shrink: true, inset: 120 }),
      art("flourishDivider", colours, page.width / 2 - 70, 166, 140, 20),
      centredText(page, 192, 22, t("studio.tpl.guestNames"), { font: FONTS.cormorant, size: 14, italic: true, color: palette.muted, valign: "middle", shrink: true, inset: 60 }),
    ]),
  ]);
}

function balloon(cx: number, top: number, width: number, height: number, color: string, length: number): StudioElement[] {
  return [
    vrule(cx, top + height + 4, length, "#94a3b8", 0.8),
    box("triangle", cx - 5, top + height - 2, 10, 8, solid(darker(color, 0.12))),
    shadowed(box("ellipse", cx - width / 2, top, width, height, radial(lighter(color, 0.25), darker(color, 0.08), { cx: 0.38, cy: 0.32, radius: 0.85 })), "soft"),
    box("ellipse", cx - width / 2 + width * 0.2, top + height * 0.14, width * 0.18, height * 0.24, solid("#ffffff"), { opacity: 0.5, rotation: 24 }),
  ];
}

function birthdayCard({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const coral = "#f43f5e";
  const indigo = "#312e81";
  const teal = "#2dd4bf";
  const sun = "#fbbf24";
  const lilac = "#a78bfa";
  const panelTop = 270;
  return design(t("studio.templates.items.birthdayCard"), [coral, indigo, teal, sun, lilac], [
    pageOf(CARD, gradient(180, ["#fff7ed", "#fff1f2"]), [
      art("sunburst", { primary: "#fde2cf", secondary: "#fbcfe8" }, 0, 0, page.width, page.height, { opacity: 0.45 }),
      art("confetti", { primary: "#fb7185", secondary: teal }, 16, 16, page.width - 32, 240, { opacity: 0.8 }),
      ...balloon(96, 74, 70, 86, "#fb7185", 110),
      ...balloon(168, 44, 76, 94, sun, 132),
      ...balloon(page.width - 168, 60, 74, 90, teal, 120),
      ...balloon(page.width - 96, 34, 68, 84, lilac, 150),
      art("waves", { primary: "#fb7185", secondary: "#fde68a" }, 0, page.height - 84, page.width, 84),
      shadowed(box("rect", 36, panelTop, page.width - 72, 252, solid("#ffffff"), { radius: 24 }), "lifted", coral),
      centredText(page, panelTop + 18, 50, t("studio.tpl.extras.birthdayHappy"), { font: FONTS.pacifico, size: 34, color: coral, valign: "middle", shrink: true, inset: 60 }),
      centredText(page, panelTop + 66, 64, t("studio.tpl.extras.birthdayWord"), { font: FONTS.abril, size: 46, color: indigo, lineHeight: 1, valign: "middle", shrink: true, inset: 52 }),
      art("dotsDivider", { primary: teal, secondary: coral }, page.width / 2 - 60, panelTop + 138, 120, 10),
      centredText(page, panelTop + 156, 52, t("studio.tpl.extras.birthdayBody"), { font: FONTS.nunito, size: 12.5, color: "#475569", lineHeight: 1.5, shrink: true, inset: 64 }),
      centredText(page, panelTop + 210, 30, t("studio.tpl.fromName"), { font: FONTS.pacifico, size: 17, color: darker(coral, 0.22), valign: "middle", shrink: true, inset: 64 }),
    ]),
  ]);
}

function firework(cx: number, cy: number, radius: number, color: string): StudioElement[] {
  const rays = 14;
  return Array.from({ length: rays }, (_, index) => {
    const angle = (index / rays) * Math.PI * 2;
    const length = radius * (index % 2 ? 0.42 : 0.6);
    const middle = radius * 0.3 + length / 2;
    const tip = radius * 0.3 + length + 5;
    return [
      box("line", cx + Math.cos(angle) * middle - length / 2, cy + Math.sin(angle) * middle - 4, length, 8, { type: "none" }, { stroke: stroke(color, 1.4), rotation: (angle * 180) / Math.PI }),
      box("ellipse", cx + Math.cos(angle) * tip - 1.8, cy + Math.sin(angle) * tip - 1.8, 3.6, 3.6, solid(color)),
    ];
  }).flat();
}

function newYearCard({ t }: TemplateContext) {
  const page = sizeOf(GREETING);
  const gold = "#fbbf24";
  const pink = "#f472b6";
  const night = "#0a0f24";
  const sparkles = [
    [150, 30, 5],
    [214, 34, 6],
    [300, 28, 4],
    [356, 44, 5],
    [470, 150, 5],
    [36, 180, 6],
    [130, 316, 5],
    [380, 312, 6],
    [460, 314, 4],
    [40, 314, 6],
  ];
  return design(t("studio.templates.items.newYearCard"), [gold, night, pink, "#fde68a"], [
    pageOf(GREETING, radial("#2d1f66", night, { cy: 0.38, radius: 1.05 }), [
      art("sunburst", { primary: "#3b2f7a", secondary: gold }, 0, 0, page.width, page.height, { opacity: 0.09 }),
      frame("decoFrame", { primary: gold, secondary: gold }, page),
      ...sparkles.map(([x = 0, y = 0, side = 4]) => box("star", x, y, side, side, solid("#fde68a"), { points: 4, inner: 0.35, opacity: 0.85 })),
      ...firework(88, 104, 52, pink),
      ...firework(416, 100, 58, gold),
      ...firework(440, 258, 32, "#60a5fa"),
      ...firework(70, 262, 30, gold),
      centredText(page, 48, 50, t("studio.tpl.extras.newYearScript"), { font: FONTS.greatVibes, size: 40, color: "#fde68a", valign: "middle", shrink: true, inset: 132 }),
      centredText(page, 96, 128, "2027", { font: FONTS.bebas, size: 132, color: gold, lineHeight: 0.9, valign: "middle", shrink: true, inset: 120, shadow: "deep" }),
      art("diamondDivider", { primary: gold, secondary: pink }, page.width / 2 - 80, 230, 160, 10),
      centredText(page, 250, 40, t("studio.tpl.extras.newYearBody"), { font: FONTS.raleway, size: 11.5, color: "#cbd5e1", lineHeight: 1.45, shrink: true, inset: 124 }),
      centredText(page, 294, 34, t("studio.tpl.fromName"), { font: FONTS.greatVibes, size: 26, color: gold, valign: "middle", shrink: true, inset: 124 }),
    ]),
  ]);
}

function giftTags({ t }: TemplateContext) {
  const page = sizeOf(SHEET);
  const colours = ["#4f7a5a", "#b4472f", "#1e3a5f", "#a8770d", "#9b5d6b", "#5b4fa8"];
  const titles = ["studio.tpl.extras.giftTagTitle1", "studio.tpl.extras.giftTagTitle2", "studio.tpl.extras.giftTagTitle3"];
  const width = 236;
  const height = 214;
  const gapX = 40;
  const gapY = 32;
  const left = (page.width - width * 2 - gapX) / 2;
  const top = 40;
  return design(t("studio.templates.items.giftTags"), colours, [
    pageOf(SHEET, solid("#fbfaf8"), [
      ...colours.flatMap((colour, index) => {
        const x = left + (index % 2) * (width + gapX);
        const y = top + Math.floor(index / 2) * (height + gapY);
        const ink = darker(colour, 0.3);
        const line = (offset: number, key: string) => [
          text(x + 30, y + offset, 56, 20, t(key), { font: FONTS.montserrat, size: 8.5, bold: true, color: ink, upper: true, spacing: 1, valign: "bottom", shrink: true }),
          rule(x + 90, y + offset + 18, width - 120, "#cbd5e1", 0.8),
        ];
        return [
          box("rect", x - 8, y - 8, width + 16, height + 16, { type: "none" }, { radius: 22, stroke: stroke("#b6bcc6", 0.8, "dashed") }),
          shadowed(box("rect", x, y, width, height, gradient(150, [lighter(colour, 0.08), darker(colour, 0.18)]), { radius: 16 }), "soft"),
          box("rect", x + 6, y + 6, width - 12, height - 12, { type: "none" }, { radius: 12, stroke: stroke("#ffffff", 0.7, "dashed") }),
          box("ellipse", x + width / 2 - 11, y + 9, 22, 22, foil("gold", 135)),
          box("ellipse", x + width / 2 - 6, y + 14, 12, 12, solid("#fbfaf8")),
          shadowed(box("rect", x + 16, y + 40, width - 32, height - 56, solid("#ffffff"), { radius: 10 }), "soft"),
          text(x + 24, y + 48, width - 48, 42, t(titles[index % titles.length] ?? ""), { font: FONTS.greatVibes, size: 30, color: colour, align: "center", valign: "middle", shrink: true }),
          art("dotsDivider", { primary: colour, secondary: colour }, x + width / 2 - 46, y + 94, 92, 7),
          ...line(110, "studio.tpl.extras.giftTo"),
          ...line(138, "studio.tpl.voucherFrom"),
          box("heart", x + width / 2 - 7, y + 172, 14, 12, solid(colour)),
        ];
      }),
      centredText(page, top + height * 3 + gapY * 2 + 24, 16, t("studio.tpl.extras.giftCutGuide"), { font: FONTS.montserrat, size: 8, color: "#64748b", spacing: 1.5, upper: true, shrink: true }),
    ]),
  ]);
}

export const CARD_TEMPLATES: StudioTemplate[] = [
  { id: "thankYou", category: "cards", size: CARD, build: thankYou },
  { id: "congrats", category: "cards", size: CARD, build: congrats },
  { id: "businessCardClassic", category: "cards", size: BUSINESS, build: businessClassic },
  { id: "businessCardModern", category: "cards", size: BUSINESS, build: businessModern },
  { id: "nameBadge", category: "cards", size: BADGE, build: nameBadge },
  { id: "tableCard", category: "cards", size: TABLE, build: tableCard },
  { id: "birthdayCard", category: "cards", size: CARD, build: birthdayCard },
  { id: "newYearCard", category: "cards", size: GREETING, build: newYearCard },
  { id: "giftTags", category: "cards", size: SHEET, build: giftTags },
];
