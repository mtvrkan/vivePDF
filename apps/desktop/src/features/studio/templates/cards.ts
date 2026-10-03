import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, linear, pageOf, photoSlot, qr, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const CARD = "a5" as const;
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

export const CARD_TEMPLATES: StudioTemplate[] = [
  { id: "thankYou", category: "cards", size: CARD, build: thankYou },
  { id: "congrats", category: "cards", size: CARD, build: congrats },
  { id: "businessCardClassic", category: "cards", size: BUSINESS, build: businessClassic },
  { id: "businessCardModern", category: "cards", size: BUSINESS, build: businessModern },
  { id: "nameBadge", category: "cards", size: BADGE, build: nameBadge },
  { id: "tableCard", category: "cards", size: TABLE, build: tableCard },
];
