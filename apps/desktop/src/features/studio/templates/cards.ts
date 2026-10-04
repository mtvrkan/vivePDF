import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, linear, pageOf, photoSlot, qr, rule, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const CARD = "a5" as const;
const SHEET = "a4" as const;
const GREETING: TemplateSize = { width: 504, height: 360 };
const BUSINESS = "businessCard" as const;
const BADGE: TemplateSize = { width: 216, height: 306 };
const TABLE: TemplateSize = { width: 360, height: 252 };

const CONTACT_KEYS = ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website", "studio.tpl.address"];

function contactLines(t: TemplateContext["t"], x: number, y: number, width: number, color: string, font: string, accent: string, rows = CONTACT_KEYS): StudioElement[] {
  return rows.flatMap((key, index) => [
    box("ellipse", x, y + index * 17 + 4, 5, 5, solid(accent)),
    text(x + 11, y + index * 17, width - 11, 14, t(key), { font, size: 7.5, color, valign: "middle", shrink: true }),
  ]);
}

function thankYou({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const rose = "#be5a6b";
  const sage = "#7d8f69";
  const colours = { primary: rose, secondary: sage };
  return design(t("studio.templates.items.thankYou"), [rose, sage], [
    pageOf(CARD, solid("#fdf6f3"), [
      art("blob", { primary: "#f6d5d0", secondary: "#f9e8e1" }, -60, -50, 260, 240, { opacity: 0.9 }),
      art("blob", { primary: "#dfe6d2", secondary: "#eef2e6" }, page.width - 190, page.height - 220, 260, 260, { opacity: 0.9, rotation: 160 }),
      centredText(page, 190, 110, t("studio.tpl.thankYou"), { font: FONTS.allura, size: 72, color: rose, shrink: true, valign: "middle" }),
      art("flourishDivider", colours, page.width / 2 - 80, 304, 160, 22),
      centredText(page, 340, 80, t("studio.tpl.thankYouBody"), { font: FONTS.cormorant, size: 15, italic: true, color: "#4b5563", lineHeight: 1.45, shrink: true, inset: 70 }),
      centredText(page, 440, 30, t("studio.tpl.fromName"), { font: FONTS.dancing, size: 20, color: sage, shrink: true }),
    ]),
  ]);
}

function congrats({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const navy = "#1e2a4a";
  const gold = "#e0b04a";
  return design(t("studio.templates.items.congrats"), [navy, gold], [
    pageOf(CARD, solid(navy), [
      art("confetti", { primary: gold, secondary: "#f472b6" }, 0, 0, page.width, page.height * 0.55, { opacity: 0.85 }),
      art("starSeal", { primary: gold, secondary: navy }, page.width / 2 - 55, 150, 110, 110),
      text(page.width / 2 - 40, 180, 80, 50, "★", { font: FONTS.inter, size: 34, color: navy, align: "center", valign: "middle" }),
      centredText(page, 290, 90, t("studio.tpl.congratulations"), { font: FONTS.abril, size: 40, color: "#ffffff", lineHeight: 1.05, shrink: true, valign: "middle" }),
      rule(page.width / 2 - 40, 396, 80, gold, 2),
      centredText(page, 414, 70, t("studio.tpl.congratsBody"), { font: FONTS.raleway, size: 13, color: "#d1d5db", lineHeight: 1.5, shrink: true, inset: 60 }),
      centredText(page, 500, 26, t("studio.tpl.fromName"), { font: FONTS.dancing, size: 20, color: gold, shrink: true }),
    ]),
  ]);
}

function businessClassic({ t }: TemplateContext) {
  const page = sizeOf(BUSINESS);
  const ink = "#1f2937";
  const gold = "#b08d57";
  return design(t("studio.templates.items.businessCardClassic"), [ink, gold], [
    pageOf(BUSINESS, solid("#fbfaf7"), [
      box("rect", 10, 10, page.width - 20, page.height - 20, { type: "none" }, { stroke: { color: gold, width: 0.8, dash: "solid" } }),
      art("shield", { primary: gold, secondary: "#ffffff" }, page.width / 2 - 14, 22, 28, 35),
      centredText(page, 64, 26, t("studio.tpl.personName"), { font: FONTS.cormorant, size: 18, bold: true, color: ink, shrink: true, inset: 20 }),
      centredText(page, 90, 14, t("studio.tpl.jobTitle"), { font: FONTS.cormorant, size: 9, color: gold, spacing: 2, upper: true, shrink: true, inset: 20 }),
      centredText(page, 112, 14, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 9, italic: true, color: "#6b7280", shrink: true, inset: 20 }),
    ]),
    pageOf(BUSINESS, solid(ink), [
      ...contactLines(t, 22, 36, 150, "#f3f4f6", FONTS.inter, gold),
      qr("https://example.com", page.width - 82, 38, 62, "#ffffff"),
    ]),
  ]);
}

function businessModern({ t }: TemplateContext) {
  const page = sizeOf(BUSINESS);
  const teal = "#0f766e";
  const lime = "#a3e635";
  return design(t("studio.templates.items.businessCardModern"), [teal, lime], [
    pageOf(BUSINESS, solid("#ffffff"), [
      box("rect", 0, 0, 86, page.height, linear(160, teal, "#134e4a")),
      art("arcRings", { primary: lime, secondary: "#5eead4" }, 8, 36, 70, 70),
      text(100, 30, page.width - 114, 24, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 15, bold: true, color: "#111827", shrink: true }),
      text(100, 54, page.width - 114, 14, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 8, color: teal, spacing: 1.5, upper: true, shrink: true }),
      rule(100, 78, 30, lime, 2),
      ...contactLines(t, 100, 86, page.width - 114, "#374151", FONTS.inter, teal, ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.address"]),
    ]),
    pageOf(BUSINESS, linear(135, teal, "#134e4a"), [
      art("blob", { primary: lime, secondary: "#5eead4" }, page.width - 120, -40, 160, 160, { opacity: 0.35 }),
      centredText(page, 52, 26, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 18, bold: true, color: "#ffffff", spacing: 1, shrink: true, inset: 20 }),
      centredText(page, 80, 14, t("studio.tpl.website"), { font: FONTS.montserrat, size: 8, color: lime, spacing: 1.5, shrink: true, inset: 20 }),
    ]),
  ]);
}

function nameBadge({ t }: TemplateContext) {
  const page = sizeOf(BADGE);
  const indigo = "#3730a3";
  const amber = "#f59e0b";
  return design(t("studio.templates.items.nameBadge"), [indigo, amber], [
    pageOf(BADGE, solid("#ffffff"), [
      box("rect", 0, 0, page.width, 86, linear(135, indigo, "#6d28d9")),
      art("waves", { primary: "#ffffff", secondary: amber }, 0, 56, page.width, 30, { opacity: 0.35 }),
      box("ellipse", page.width / 2 - 8, 14, 16, 6, solid("#ffffff"), { opacity: 0.85 }),
      centredText(page, 30, 30, t("studio.tpl.eventName"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", spacing: 1, upper: true, shrink: true, inset: 14 }),
      ...photoSlot(page.width / 2 - 38, 96, 76, 76, "#e0e7ff", "circle"),
      centredText(page, 182, 44, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 20, bold: true, color: "#111827", lineHeight: 1.1, shrink: true, inset: 14, valign: "middle" }),
      centredText(page, 228, 16, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 10, color: indigo, shrink: true, inset: 14 }),
      centredText(page, 246, 16, t("studio.tpl.companyName"), { font: FONTS.inter, size: 9, color: "#6b7280", shrink: true, inset: 14 }),
      box("rect", 0, page.height - 22, page.width, 22, solid(amber)),
      centredText(page, page.height - 22, 22, t("studio.tpl.attendee"), { font: FONTS.montserrat, size: 9, bold: true, color: "#111827", spacing: 3, upper: true, valign: "middle", shrink: true }),
    ]),
  ]);
}

function tableCard({ t }: TemplateContext) {
  const page = sizeOf(TABLE);
  const sage = "#5f7161";
  const gold = "#b08d57";
  return design(t("studio.templates.items.tableCard"), [sage, gold], [
    pageOf(TABLE, solid("#fbf8f3"), [
      frame("doubleFrame", { primary: sage, secondary: gold }, page),
      centredText(page, 46, 24, t("studio.tpl.table"), { font: FONTS.cormorant, size: 16, color: gold, spacing: 6, upper: true, shrink: true }),
      centredText(page, 70, 90, "{n}", { font: FONTS.greatVibes, size: 74, color: sage, valign: "middle", shrink: true }),
      art("flourishDivider", { primary: sage, secondary: gold }, page.width / 2 - 70, 166, 140, 20),
      centredText(page, 192, 22, t("studio.tpl.guestNames"), { font: FONTS.cormorant, size: 12, italic: true, color: "#4b5563", shrink: true }),
    ]),
  ]);
}

function balloon(cx: number, top: number, width: number, height: number, color: string): StudioElement[] {
  return [
    vrule(cx, top + height + 4, 96, "#94a3b8", 0.8),
    box("triangle", cx - 5, top + height - 2, 10, 8, solid(color)),
    box("ellipse", cx - width / 2, top, width, height, solid(color)),
    box("ellipse", cx - width / 2 + width * 0.2, top + height * 0.14, width * 0.18, height * 0.24, solid("#ffffff"), { opacity: 0.45, rotation: 24 }),
  ];
}

function birthdayCard({ t }: TemplateContext) {
  const page = sizeOf(CARD);
  const coral = "#f43f5e";
  const indigo = "#312e81";
  const teal = "#2dd4bf";
  return design(t("studio.templates.items.birthdayCard"), [coral, indigo], [
    pageOf(CARD, solid("#fffaf0"), [
      art("confetti", { primary: "#fb7185", secondary: teal }, 12, 12, page.width - 24, 250, { opacity: 0.85 }),
      ...balloon(92, 70, 74, 90, "#fb7185"),
      ...balloon(166, 40, 80, 98, "#fbbf24"),
      ...balloon(page.width - 166, 56, 76, 92, teal),
      ...balloon(page.width - 92, 30, 70, 86, "#a78bfa"),
      centredText(page, 266, 56, t("studio.tpl.extras.birthdayHappy"), { font: FONTS.pacifico, size: 40, color: coral, valign: "middle", shrink: true, inset: 40 }),
      centredText(page, 320, 70, t("studio.tpl.extras.birthdayWord"), { font: FONTS.abril, size: 50, color: indigo, lineHeight: 1, valign: "middle", shrink: true, inset: 30 }),
      art("dotsDivider", { primary: teal, secondary: teal }, page.width / 2 - 60, 398, 120, 10),
      centredText(page, 418, 58, t("studio.tpl.extras.birthdayBody"), { font: FONTS.nunito, size: 13, color: "#475569", lineHeight: 1.5, shrink: true, inset: 56 }),
      centredText(page, 478, 30, t("studio.tpl.fromName"), { font: FONTS.caveat, size: 24, bold: true, color: coral, valign: "middle", shrink: true, inset: 60 }),
      art("waves", { primary: "#fb7185", secondary: "#fde68a" }, 0, page.height - 78, page.width, 78),
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
  const sparkles = [
    [40, 40, 9],
    [150, 24, 5],
    [214, 30, 6],
    [300, 22, 4],
    [474, 34, 8],
    [486, 150, 5],
    [26, 176, 6],
    [120, 326, 5],
    [386, 318, 6],
    [470, 330, 4],
    [356, 44, 5],
    [24, 330, 7],
  ];
  return design(t("studio.templates.items.newYearCard"), [gold, "#1e1b4b"], [
    pageOf(GREETING, linear(180, "#0b1026", "#2a1b5e"), [
      ...sparkles.map(([x = 0, y = 0, side = 4]) => box("star", x, y, side, side, solid("#fde68a"), { points: 4, inner: 0.35, opacity: 0.85 })),
      ...firework(82, 104, 56, pink),
      ...firework(420, 96, 62, gold),
      ...firework(446, 262, 36, "#60a5fa"),
      ...firework(62, 268, 32, gold),
      centredText(page, 52, 50, t("studio.tpl.extras.newYearScript"), { font: FONTS.greatVibes, size: 40, color: "#fde68a", valign: "middle", shrink: true, inset: 130 }),
      centredText(page, 98, 130, "2027", { font: FONTS.bebas, size: 136, color: gold, lineHeight: 0.9, valign: "middle", shrink: true, inset: 100 }),
      art("diamondDivider", { primary: gold, secondary: pink }, page.width / 2 - 80, 236, 160, 10),
      centredText(page, 254, 46, t("studio.tpl.extras.newYearBody"), { font: FONTS.raleway, size: 11.5, color: "#cbd5e1", lineHeight: 1.45, shrink: true, inset: 120 }),
      centredText(page, 304, 30, t("studio.tpl.fromName"), { font: FONTS.dancing, size: 19, color: gold, valign: "middle", shrink: true, inset: 120 }),
    ]),
  ]);
}

function giftTags({ t }: TemplateContext) {
  const page = sizeOf(SHEET);
  const colours = ["#6b8f71", "#c8553d", "#1e3a5f", "#c08a12", "#b5838d", "#6d5fb8"];
  const titles = ["studio.tpl.extras.giftTagTitle1", "studio.tpl.extras.giftTagTitle2", "studio.tpl.extras.giftTagTitle3"];
  const width = 236;
  const height = 216;
  const gapX = 40;
  const gapY = 36;
  const left = (page.width - width * 2 - gapX) / 2;
  const top = 36;
  return design(t("studio.templates.items.giftTags"), colours.slice(0, 2), [
    pageOf(SHEET, solid("#ffffff"), [
      ...colours.flatMap((colour, index) => {
        const x = left + (index % 2) * (width + gapX);
        const y = top + Math.floor(index / 2) * (height + gapY);
        const line = (offset: number, key: string) => [
          text(x + 30, y + offset, 56, 20, t(key), { font: FONTS.montserrat, size: 8.5, bold: true, color: colour, upper: true, spacing: 1, valign: "bottom", shrink: true }),
          rule(x + 90, y + offset + 18, width - 120, "#cbd5e1", 0.8),
        ];
        return [
          box("rect", x - 8, y - 8, width + 16, height + 16, { type: "none" }, { radius: 22, stroke: stroke("#cbd5e1", 0.8, "dashed") }),
          box("rect", x, y, width, height, solid(colour), { radius: 16 }),
          box("ellipse", x + width / 2 - 12, y + 10, 24, 24, { type: "none" }, { stroke: stroke("#ffffff", 1.5) }),
          box("ellipse", x + width / 2 - 8, y + 14, 16, 16, solid("#ffffff")),
          box("rect", x + 14, y + 42, width - 28, height - 56, solid("#ffffff"), { radius: 10 }),
          text(x + 24, y + 50, width - 48, 42, t(titles[index % titles.length] ?? ""), { font: FONTS.greatVibes, size: 30, color: colour, align: "center", valign: "middle", shrink: true }),
          art("dotsDivider", { primary: colour, secondary: colour }, x + width / 2 - 46, y + 96, 92, 7),
          ...line(114, "studio.tpl.extras.giftTo"),
          ...line(142, "studio.tpl.voucherFrom"),
          box("heart", x + width / 2 - 7, y + 176, 14, 12, solid(colour)),
        ];
      }),
      centredText(page, top + height * 3 + gapY * 2 + 24, 16, t("studio.tpl.extras.giftCutGuide"), { font: FONTS.inter, size: 8.5, color: "#94a3b8", spacing: 1, upper: true, shrink: true }),
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
