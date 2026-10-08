import type { StudioElement, StudioFill } from "@/types/studio";
import { darker } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, photo, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type ShadowPreset, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

type Translate = TemplateContext["t"];

const A4 = "a4" as const;
const A5 = "a5" as const;
const SLIDE = "presentation" as const;
const BOOK = { width: 432, height: 648 };
const EBOOK = { width: 500, height: 800 };
const NONE: StudioFill = { type: "none" };
const { width: W, height: H } = sizeOf(A4);
const PAGE = { width: W, height: H };
const { width: SW, height: SH } = sizeOf(SLIDE);
const SLIDE_PAGE = { width: SW, height: SH };

function copy(t: Translate, key: string): string {
  return t(`studio.tpl.covers.${key}`);
}

function framedPhoto(x: number, y: number, width: number, height: number, backing: string, preset: ShadowPreset, mask: "none" | "rounded" | "circle" = "none", color?: string): StudioElement[] {
  const shape = mask === "circle" ? box("ellipse", x, y, width, height, solid(backing)) : box("rect", x, y, width, height, solid(backing), { radius: mask === "rounded" ? 12 : 0 });
  return [shadowed(shape, preset, color), photo(x, y, width, height, mask)];
}

function fade(x: number, y: number, width: number, steps: number, step: number, color: string, peak: number): StudioElement[] {
  return Array.from({ length: steps }, (_, index) => box("rect", x, y + index * step, width, step, solid(color), { opacity: Math.round(((peak * (index + 1)) / (steps + 1)) * 100) / 100 }));
}

function barcode(x: number, y: number, width: number, height: number, ink: string): StudioElement[] {
  const pattern = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2, 1, 3, 2, 1, 1];
  const total = pattern.reduce((sum, value) => sum + value * 2, 0);
  const unit = Math.max(1, (width - 16) / total);
  let left = x + 8;
  const bars: StudioElement[] = [];
  pattern.forEach((value) => {
    bars.push(box("rect", left, y + 8, value * unit, height - 16, solid(ink)));
    left += value * unit * 2;
  });
  return [box("rect", x, y, width, height, solid("#ffffff")), ...bars];
}

function labelledLine(x: number, y: number, width: number, label: string, value: string, accent: string): StudioElement[] {
  return [
    text(x, y, width, 14, label, { font: FONTS.poppins, size: 8.5, bold: true, color: accent, upper: true, spacing: 1.4, shrink: true }),
    text(x, y + 17, width, 22, value, { font: FONTS.inter, size: 13, color: "#0f172a", shrink: true }),
    rule(x, y + 46, width, "#d5e3e8", 0.8),
  ];
}

function assignmentCover({ t }: TemplateContext) {
  const deep = "#0a2f3c";
  const teal = "#0f6f86";
  const cyan = "#67e8f9";
  const coral = "#f43f5e";
  const pill = "#d61f45";
  const margin = 56;
  const inner = W - margin * 2;
  const cardTop = 356;
  const column = (inner - 72) / 2;
  const left = margin + 24;
  const right = left + column + 24;
  const fields: [string, string][] = [
    [t("studio.tpl.subject"), copy(t, "courseName")],
    [t("studio.tpl.grade"), copy(t, "classValue")],
    [t("studio.tpl.studentName"), t("studio.tpl.personName")],
    [t("studio.tpl.studentNumber"), "2026 1042"],
    [t("studio.tpl.teacher"), copy(t, "teacherValue")],
    [copy(t, "submissionDate"), "{date}"],
  ];
  return design(t("studio.templates.items.assignmentCover"), [deep, teal, coral, "#f6f9fa"], [
    pageOf(A4, solid("#f6f9fa"), [
      box("rect", 0, 0, W, 392, gradient(150, [deep, "#0e5468", "#127f95"])),
      art("topographic", { primary: "#5eead4", secondary: "#ffffff" }, 0, 0, W, 392, { opacity: 0.2 }),
      art("arcRings", { primary: cyan, secondary: coral }, W - 214, -86, 290, 290, { opacity: 0.55 }),
      box("ellipse", W - 132, 238, 40, 40, solid(coral), { opacity: 0.95 }),
      box("ellipse", W - 84, 214, 14, 14, solid(cyan), { opacity: 0.9 }),
      box("rect", margin, 64, 128, 26, solid(pill), { radius: 13 }),
      text(margin, 64, 128, 26, copy(t, "assignment"), { font: FONTS.poppins, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(margin, 108, inner - 140, 18, t("studio.tpl.schoolName"), { font: FONTS.poppins, size: 11, bold: true, color: "#cffafe", upper: true, spacing: 2, shrink: true }),
      text(margin, 136, inner - 90, 132, copy(t, "assignmentTitle"), { font: FONTS.poppins, size: 38, bold: true, color: "#ffffff", lineHeight: 1.08, valign: "bottom", shrink: true }),
      box("rect", margin, 282, 56, 4, solid(coral), { radius: 2 }),
      text(margin, 298, inner - 120, 40, copy(t, "assignmentSubtitle"), { font: FONTS.inter, size: 12.5, color: "#d5f8fd", lineHeight: 1.4, shrink: true }),
      shadowed(box("rect", margin, cardTop, inner, 296, solid("#ffffff"), { radius: 18 }), "lifted"),
      box("rect", margin, cardTop + 24, 4, 20, solid(coral), { radius: 2 }),
      text(left, cardTop + 24, inner - 48, 20, copy(t, "studentDetails"), { font: FONTS.poppins, size: 13, bold: true, color: deep, valign: "middle", shrink: true }),
      ...fields.flatMap(([label, value], index) => labelledLine(index % 2 ? right : left, cardTop + 66 + Math.floor(index / 2) * 72, column, label, value, teal)),
      text(margin, 672, 300, 14, copy(t, "teacherRemarks"), { font: FONTS.poppins, size: 8.5, bold: true, color: teal, upper: true, spacing: 1.4, shrink: true }),
      rule(margin, 706, 320, "#c3d3d9", 0.8, "dashed"),
      rule(margin, 730, 320, "#c3d3d9", 0.8, "dashed"),
      shadowed(box("rect", W - margin - 120, 664, 120, 72, solid("#ffffff"), { radius: 14, stroke: stroke(teal, 1.2, "dashed") }), "soft"),
      text(W - margin - 120, 674, 120, 14, t("studio.tpl.score"), { font: FONTS.poppins, size: 8.5, bold: true, color: teal, align: "center", upper: true, spacing: 1.4, shrink: true }),
      art("waves", { primary: deep, secondary: teal }, 0, H - 96, W, 64),
      box("rect", 0, H - 40, W, 40, solid(deep)),
      centredText(PAGE, H - 30, 18, t("studio.tpl.academicYear"), { font: FONTS.poppins, size: 10, bold: true, color: "#ffffff", spacing: 1.5, upper: true, valign: "middle", shrink: true }),
    ]),
  ]);
}

function thesisCover({ t }: TemplateContext) {
  const palette = PALETTES.burgundyGold;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  const goldInk = darker(palette.accent2, 0.5);
  const half = (W - 180) / 2;
  const person = (x: number, label: string, name: string, detail: string): StudioElement[] => [
    text(x, 600, half - 10, 14, label, { font: FONTS.cinzel, size: 9, bold: true, color: goldInk, align: "center", upper: true, spacing: 2.5, shrink: true }),
    text(x, 620, half - 10, 22, name, { font: FONTS.garamond, size: 15, bold: true, color: palette.ink, align: "center", shrink: true }),
    text(x, 644, half - 10, 18, detail, { font: FONTS.garamond, size: 11, italic: true, color: palette.muted, align: "center", shrink: true }),
  ];
  return design(t("studio.templates.items.thesisCover"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.4, radius: 1 }), [
      art("guillocheRosette", colours, W / 2 - 190, 300, 380, 380, { opacity: 0.07 }),
      frame("guillocheBorder", colours, PAGE),
      art("laurel", colours, W / 2 - 62, 78, 124, 118),
      shadowed(art("shield", { primary: palette.accent, secondary: palette.accent2 }, W / 2 - 22, 106, 44, 56), "soft"),
      centredText(PAGE, 214, 28, copy(t, "universityName"), { font: FONTS.cinzel, size: 20, bold: true, color: palette.accent, spacing: 2, shrink: true, inset: 72 }),
      centredText(PAGE, 246, 36, copy(t, "facultyName"), { font: FONTS.garamond, size: 12.5, color: palette.muted, lineHeight: 1.4, shrink: true, inset: 84 }),
      art("diamondDivider", colours, W / 2 - 110, 294, 220, 14),
      centredText(PAGE, 326, 18, copy(t, "thesisType"), { font: FONTS.cinzel, size: 11, bold: true, color: goldInk, spacing: 5, upper: true, shrink: true, inset: 84 }),
      centredText(PAGE, 354, 140, copy(t, "thesisTitle"), { font: FONTS.garamond, size: 31, bold: true, color: palette.ink, lineHeight: 1.16, valign: "middle", shrink: true, inset: 76 }),
      box("rect", W * 0.38, 508, W * 0.24, 1.6, foil("gold", 0)),
      centredText(PAGE, 522, 40, copy(t, "thesisStatement"), { font: FONTS.garamond, size: 11.5, italic: true, color: palette.muted, lineHeight: 1.4, shrink: true, inset: 104 }),
      ...person(90, copy(t, "preparedByLabel"), t("studio.tpl.personName"), `${t("studio.tpl.studentNumber")}: 210204012`),
      vrule(W / 2, 600, 64, palette.accent2, 0.8),
      ...person(W / 2 + 10, copy(t, "advisor"), copy(t, "advisorName"), copy(t, "advisorDept")),
      art("dotsDivider", { primary: palette.accent2, secondary: palette.accent2 }, W / 2 - 70, H - 158, 140, 8),
      centredText(PAGE, H - 138, 20, copy(t, "thesisPlace"), { font: FONTS.cinzel, size: 12, bold: true, color: palette.accent, spacing: 2.5, shrink: true, inset: 96 }),
    ]),
  ]);
}

function bookCover({ t }: TemplateContext) {
  const { width, height } = BOOK;
  const night = "#0b1220";
  const gold = "#d6b25e";
  const ivory = "#f8f1df";
  const margin = 40;
  const inner = width - margin * 2;
  const centre = width / 2;
  const ring = 268;
  return design(t("studio.templates.items.bookCover"), [night, gold, ivory], [
    pageOf(BOOK, radial("#1d2c48", night, { cy: 0.4, radius: 1 }), [
      art("sunburst", { primary: "#33456b", secondary: gold }, centre - 324, 280 - 324, 648, 648, { opacity: 0.14 }),
      text(margin, 44, inner, 16, copy(t, "authorName"), { font: FONTS.raleway, size: 11, bold: true, color: gold, align: "center", upper: true, spacing: 5, shrink: true }),
      art("diamondDivider", { primary: gold, secondary: gold }, centre - 70, 70, 140, 10),
      shadowed(box("ellipse", centre - ring / 2, 280 - ring / 2 - 2, ring, ring, foil("gold", 135)), "lifted", "#000000"),
      ...framedPhoto(centre - ring / 2 + 7, 280 - ring / 2 + 5, ring - 14, ring - 14, "#2b3b57", "soft", "circle"),
      text(margin, 428, inner, 100, copy(t, "bookTitle"), { font: FONTS.playfair, size: 46, bold: true, color: ivory, align: "center", valign: "middle", lineHeight: 1.02, shrink: true }),
      box("rect", centre - 40, 540, 80, 1.6, foil("gold", 0)),
      text(margin + 12, 554, inner - 24, 36, copy(t, "bookBlurb"), { font: FONTS.playfair, size: 11.5, italic: true, color: "#cbd5e1", align: "center", lineHeight: 1.35, shrink: true }),
      rule(margin, height - 44, inner, "#33415c", 0.8),
      text(margin, height - 34, inner / 2, 16, copy(t, "bookGenre"), { font: FONTS.raleway, size: 9, bold: true, color: gold, upper: true, spacing: 2.5, shrink: true }),
      text(width / 2, height - 34, inner / 2, 16, copy(t, "publisher"), { font: FONTS.raleway, size: 9, bold: true, color: ivory, align: "right", upper: true, spacing: 2.5, shrink: true }),
    ]),
  ]);
}

function magazineCover({ t }: TemplateContext) {
  const red = "#d61f26";
  const ink = "#0f172a";
  const yellow = "#facc15";
  const shade = "#020617";
  const margin = 32;
  const inner = W - margin * 2;
  const lines = [1, 2, 3];
  return design(t("studio.templates.items.magazineCover"), [red, yellow, ink], [
    pageOf(A4, solid("#cbd5e1"), [
      ...framedPhoto(0, 0, W, H, "#bcc6d2", "soft"),
      text(margin, 10, inner, 150, copy(t, "magazineName"), { font: FONTS.bebas, size: 156, color: red, align: "center", valign: "middle", lineHeight: 0.95, spacing: 8, shrink: true }),
      rule(margin, 166, inner, ink, 1.4),
      text(margin, 172, inner, 16, copy(t, "issueLine"), { font: FONTS.inter, size: 9, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 2.5, shrink: true }),
      rule(margin, 194, inner, ink, 0.6),
      box("rect", 0, 214, margin + 222, 268, solid("#ffffff"), { opacity: 0.84 }),
      box("rect", 0, 214, 8, 268, solid(red)),
      ...lines.flatMap((number, index) => {
        const y = 230 + index * 84;
        return [
          text(margin, y, 196, 16, copy(t, `coverKicker${number}`), { font: FONTS.bebas, size: 15, color: red, spacing: 2, shrink: true }),
          text(margin, y + 20, 196, 46, copy(t, `coverLine${number}`), { font: FONTS.playfair, size: 17, bold: true, color: ink, lineHeight: 1.12, shrink: true }),
          ...(index < lines.length - 1 ? [rule(margin, y + 74, 28, red, 1.6)] : []),
        ];
      }),
      shadowed(box("burst", W - 180, 220, 148, 148, solid(yellow), { points: 22, inner: 0.86, rotation: -12 }), "long"),
      box("ellipse", W - 166, 234, 120, 120, NONE, { stroke: stroke(ink, 1, "dashed"), opacity: 0.6 }),
      text(W - 162, 262, 112, 64, copy(t, "magazineBadge"), { font: FONTS.bebas, size: 26, color: ink, align: "center", valign: "middle", lineHeight: 0.95, rotation: -12, shrink: true }),
      ...fade(0, H - 358, W, 12, 6, shade, 0.8),
      box("rect", 0, H - 286, W, 286, solid(shade), { opacity: 0.8 }),
      box("rect", margin, H - 264, 92, 20, solid(red)),
      text(margin, H - 264, 92, 20, copy(t, "coverStory"), { font: FONTS.bebas, size: 13, color: "#ffffff", align: "center", valign: "middle", spacing: 2, shrink: true }),
      text(margin, H - 236, inner - 20, 124, copy(t, "magazineHeadline"), { font: FONTS.playfair, size: 52, bold: true, color: "#ffffff", lineHeight: 1.02, valign: "bottom", shrink: true }),
      text(margin, H - 104, inner - 140, 40, copy(t, "magazineDeck"), { font: FONTS.inter, size: 12, color: "#e2e8f0", lineHeight: 1.4, shrink: true }),
      ...barcode(W - margin - 96, H - 112, 96, 52, ink),
      rule(margin, H - 50, inner, "#475569", 0.8),
      text(margin, H - 40, inner - 190, 16, copy(t, "magazineMore"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(W - margin - 180, H - 40, 180, 16, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: "#cbd5e1", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function ebookCover({ t }: TemplateContext) {
  const { width, height } = EBOOK;
  const peach = "#fdba74";
  const margin = 48;
  const inner = width - margin * 2;
  return design(t("studio.templates.items.ebookCover"), ["#2e1065", "#be185d", peach], [
    pageOf(EBOOK, gradient(160, ["#2e1065", "#6b1a78", "#be185d"]), [
      art("halftone", { primary: "#f9a8d4", secondary: "#c4b5fd" }, 0, 0, width, height, { opacity: 0.22 }),
      art("blob", { primary: "#f472b6", secondary: "#8b5cf6" }, 180, 320, 420, 420, { opacity: 0.5 }),
      box("ellipse", -140, 540, 380, 380, NONE, { stroke: stroke("#f9a8d4", 1.5), opacity: 0.45 }),
      art("arcRings", { primary: peach, secondary: "#f9a8d4" }, width - 196, -40, 230, 230, { opacity: 0.7 }),
      box("ellipse", width - 112, 72, 32, 32, solid(peach)),
      shadowed(box("rect", margin, 72, 156, 28, solid(peach), { radius: 14 }), "soft"),
      text(margin, 72, 156, 28, copy(t, "ebookLabel"), { font: FONTS.montserrat, size: 10, bold: true, color: "#4c0519", align: "center", valign: "middle", upper: true, spacing: 1.6, shrink: true }),
      text(margin, 144, inner, 272, copy(t, "ebookTitle"), { font: FONTS.montserrat, size: 56, bold: true, color: "#ffffff", lineHeight: 1.02, valign: "bottom", shrink: true }),
      box("rect", margin, 436, 72, 6, gradient(0, [peach, "#f472b6"]), { radius: 3 }),
      text(margin, 460, inner - 40, 64, copy(t, "ebookSubtitle"), { font: FONTS.inter, size: 16, color: "#fce7f3", lineHeight: 1.4, shrink: true }),
      box("rect", margin, 572, inner, 104, solid("#ffffff"), { radius: 22, opacity: 0.12, stroke: stroke("#ffffff", 1) }),
      ...framedPhoto(margin + 18, 588, 72, 72, "#f9a8d4", "glow", "circle", "#f9a8d4"),
      text(margin + 108, 600, inner - 132, 22, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 16, bold: true, color: "#ffffff", shrink: true }),
      text(margin + 108, 626, inner - 132, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 11.5, color: "#fbcfe8", shrink: true }),
      rule(margin, height - 84, 32, peach, 1.4),
      text(margin, height - 72, inner, 16, copy(t, "ebookFooter"), { font: FONTS.montserrat, size: 10, bold: true, color: peach, upper: true, spacing: 1.8, shrink: true }),
    ]),
  ]);
}

const DECK = { accent: "#ff5a36", warm: "#ff8a5c", deep: "#b8330f", accentInk: "#c2360f", ink: "#111827", soft: "#fff4ef", muted: "#5b6270" };

function deckFooter(t: Translate, number: string, brand: string, muted: string): StudioElement[] {
  return [
    text(64, SH - 40, 300, 14, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 9, bold: true, color: brand, shrink: true }),
    text(SW - 124, SH - 40, 60, 14, number, { font: FONTS.poppins, size: 9, color: muted, align: "right" }),
  ];
}

function businessDeck({ t }: TemplateContext) {
  const { accent, warm, deep, accentInk, ink, soft, muted } = DECK;
  const agenda = [1, 2, 3, 4];
  const bullets = [1, 2, 3, 4];
  const stats = [1, 2, 3];
  const card = (SW - 128 - 48) / 3;
  const contacts = ["studio.tpl.email", "studio.tpl.phone", "studio.tpl.website"];
  const coral = { primary: accent, secondary: warm };
  return design(t("studio.templates.items.businessDeck"), [accent, ink, soft], [
    pageOf(SLIDE, solid("#ffffff"), [
      ...framedPhoto(520, 0, 440, SH, "#fde0d6", "soft"),
      art("halftone", coral, 0, SH - 150, 480, 150, { opacity: 0.35 }),
      shadowed(box("rect", 472, SH - 168, 168, 168, gradient(135, [accent, warm])), "lifted"),
      art("arcRings", { primary: "#ffffff", secondary: "#ffffff" }, 500, SH - 140, 112, 112, { opacity: 0.6 }),
      box("rect", 64, 64, 28, 28, gradient(135, [accent, warm]), { radius: 7 }),
      text(104, 64, 300, 28, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 13, bold: true, color: ink, valign: "middle", shrink: true }),
      text(64, 136, 412, 164, copy(t, "deckTitle"), { font: FONTS.poppins, size: 50, bold: true, color: ink, lineHeight: 1.04, valign: "bottom", shrink: true }),
      box("rect", 64, 318, 64, 6, gradient(0, [accent, warm]), { radius: 3 }),
      text(64, 340, 400, 50, copy(t, "deckSubtitle"), { font: FONTS.inter, size: 15, color: muted, lineHeight: 1.4, shrink: true }),
      vrule(64, 418, 40, accent, 2),
      text(78, 418, 360, 20, t("studio.tpl.personName"), { font: FONTS.poppins, size: 12, bold: true, color: ink, shrink: true }),
      text(78, 440, 360, 16, "{date}", { font: FONTS.inter, size: 11, color: muted }),
    ]),
    pageOf(SLIDE, solid(soft), [
      box("rect", 0, 0, 320, SH, gradient(160, ["#1f2937", "#0b0f19"])),
      art("topographic", { primary: accent, secondary: "#ffffff" }, 0, 0, 320, SH, { opacity: 0.16 }),
      art("arcRings", { primary: accent, secondary: "#ffffff" }, 120, 340, 240, 240, { opacity: 0.6 }),
      text(64, 80, 230, 60, copy(t, "agenda"), { font: FONTS.poppins, size: 42, bold: true, color: "#ffffff", shrink: true }),
      box("rect", 64, 152, 56, 5, gradient(0, [accent, warm]), { radius: 2.5 }),
      text(64, 174, 220, 60, copy(t, "agendaLead"), { font: FONTS.inter, size: 13, color: "#d1d5db", lineHeight: 1.4, shrink: true }),
      ...agenda.flatMap((number, index) => {
        const y = 48 + index * 108;
        return [
          shadowed(box("rect", 368, y, 528, 92, solid("#ffffff"), { radius: 14 }), "soft"),
          ...(index === 1 ? [box("rect", 368, y + 20, 4, 52, solid(accent), { radius: 2 })] : []),
          text(392, y + 18, 72, 56, `0${number}`, { font: FONTS.poppins, size: 34, bold: true, color: accentInk, valign: "middle" }),
          text(476, y + 20, 396, 26, copy(t, `agenda${number}`), { font: FONTS.poppins, size: 18, bold: true, color: ink, shrink: true }),
          text(476, y + 48, 396, 18, copy(t, `agendaNote${number}`), { font: FONTS.inter, size: 11.5, color: muted, shrink: true }),
        ];
      }),
      text(SW - 124, SH - 34, 60, 14, "02", { font: FONTS.poppins, size: 9, color: muted, align: "right" }),
    ]),
    pageOf(SLIDE, gradient(135, ["#8f2410", deep, "#dc4a20"]), [
      art("diagonalHatch", { primary: "#ffffff", secondary: warm }, 0, 0, SW, SH, { opacity: 0.12 }),
      art("arcRings", { primary: "#ffffff", secondary: "#ffd2c2" }, 580, 90, 360, 360, { opacity: 0.5 }),
      text(48, 40, 520, 260, "02", { font: FONTS.poppins, size: 230, bold: true, color: "#ffffff", lineHeight: 1, valign: "middle", opacity: 0.18 }),
      box("rect", 64, 300, 56, 5, solid("#ffffff"), { radius: 2.5 }),
      text(64, 318, 600, 60, copy(t, "agenda2"), { font: FONTS.poppins, size: 42, bold: true, color: "#ffffff", shrink: true }),
      text(64, 384, 520, 50, copy(t, "sectionLead"), { font: FONTS.inter, size: 15, color: "#ffffff", lineHeight: 1.4, shrink: true }),
      ...deckFooter(t, "03", "#ffffff", "#ffffff"),
    ]),
    pageOf(SLIDE, solid("#ffffff"), [
      art("halftone", coral, SW - 300, 0, 300, 140, { opacity: 0.3 }),
      text(64, 54, 520, 16, copy(t, "contentKicker"), { font: FONTS.poppins, size: 10, bold: true, color: accentInk, upper: true, spacing: 2, shrink: true }),
      text(64, 74, 540, 50, copy(t, "contentTitle"), { font: FONTS.poppins, size: 30, bold: true, color: ink, shrink: true }),
      ...bullets.flatMap((number, index) => {
        const y = 156 + index * 70;
        return [
          box("ellipse", 64, y, 30, 30, solid(soft), { stroke: stroke(accent, 1.2) }),
          text(64, y, 30, 30, `${number}`, { font: FONTS.poppins, size: 12, bold: true, color: accentInk, align: "center", valign: "middle" }),
          text(110, y + 4, 460, 54, copy(t, `bullet${number}`), { font: FONTS.inter, size: 15, color: ink, lineHeight: 1.4, shrink: true }),
        ];
      }),
      shadowed(box("rect", 620, 132, 276, 316, gradient(160, ["#1f2937", ink]), { radius: 20 }), "lifted"),
      text(644, 150, 80, 80, "“", { font: FONTS.poppins, size: 80, bold: true, color: accent, lineHeight: 1 }),
      text(644, 226, 228, 150, copy(t, "calloutQuote"), { font: FONTS.inter, size: 17, italic: true, color: "#ffffff", lineHeight: 1.4, shrink: true }),
      text(644, 400, 228, 18, copy(t, "calloutAuthor"), { font: FONTS.inter, size: 11, bold: true, color: warm, shrink: true }),
      ...deckFooter(t, "04", ink, muted),
    ]),
    pageOf(SLIDE, solid(soft), [
      art("halftone", coral, 40, 96, 200, 404, { opacity: 0.55 }),
      ...framedPhoto(64, 64, 400, 412, "#fbd3c5", "lifted", "rounded"),
      shadowed(box("rect", 424, 404, 80, 80, gradient(135, [accent, warm]), { radius: 14 }), "soft"),
      text(544, 92, 352, 16, copy(t, "twoColKicker"), { font: FONTS.poppins, size: 10, bold: true, color: accentInk, upper: true, spacing: 2, shrink: true }),
      text(544, 114, 352, 90, copy(t, "twoColTitle"), { font: FONTS.poppins, size: 30, bold: true, color: ink, lineHeight: 1.12, shrink: true }),
      text(544, 218, 352, 150, copy(t, "twoColBody"), { font: FONTS.inter, size: 13.5, color: "#374151", lineHeight: 1.55, shrink: true }),
      rule(544, 380, 352, "#f3c9bb", 1),
      ...[1, 2].flatMap((number, index) => [
        text(544 + index * 176, 392, 160, 44, copy(t, `fact${number}Value`), { font: FONTS.poppins, size: 32, bold: true, color: accentInk, shrink: true }),
        text(544 + index * 176, 438, 160, 18, copy(t, `fact${number}Label`), { font: FONTS.inter, size: 12, color: muted, shrink: true }),
      ]),
      ...deckFooter(t, "05", ink, muted),
    ]),
    pageOf(SLIDE, radial("#1f2937", "#0b0f19", { cx: 0.2, cy: 0.1, radius: 1.2 }), [
      art("topographic", { primary: "#334155", secondary: accent }, 0, 0, SW, SH, { opacity: 0.18 }),
      text(64, 54, 520, 16, copy(t, "statsKicker"), { font: FONTS.poppins, size: 10, bold: true, color: warm, upper: true, spacing: 2, shrink: true }),
      text(64, 74, 640, 50, copy(t, "statsTitle"), { font: FONTS.poppins, size: 30, bold: true, color: "#ffffff", shrink: true }),
      ...stats.flatMap((number, index) => {
        const x = 64 + index * (card + 24);
        return [
          shadowed(box("rect", x, 160, card, 280, gradient(160, ["#243041", "#151c2b"]), { radius: 18, stroke: stroke("#334155", 1) }), "lifted", "#000000"),
          box("rect", x + 28, 188, 40, 5, gradient(0, [accent, warm]), { radius: 2.5 }),
          text(x + 28, 212, card - 56, 90, copy(t, `stat${number}Value`), { font: FONTS.poppins, size: 64, bold: true, color: index === 0 ? warm : "#ffffff", lineHeight: 1, valign: "middle", shrink: true }),
          text(x + 28, 318, card - 56, 22, copy(t, `stat${number}Label`), { font: FONTS.poppins, size: 15, bold: true, color: "#ffffff", shrink: true }),
          text(x + 28, 346, card - 56, 60, copy(t, `stat${number}Note`), { font: FONTS.inter, size: 11.5, color: "#a7b0bf", lineHeight: 1.4, shrink: true }),
        ];
      }),
      ...deckFooter(t, "06", "#ffffff", "#a7b0bf"),
    ]),
    pageOf(SLIDE, solid("#ffffff"), [
      art("halftone", coral, SW - 320, SH - 160, 320, 160, { opacity: 0.3 }),
      shadowed(box("ellipse", -160, 140, 520, 520, gradient(135, ["#a72d0e", "#e04a1f"])), "lifted"),
      art("arcRings", { primary: "#ffffff", secondary: "#ffd2c2" }, 150, 176, 124, 124, { opacity: 0.4 }),
      text(40, 300, 260, 100, copy(t, "deckClosing"), { font: FONTS.poppins, size: 28, bold: true, color: "#ffffff", lineHeight: 1.12, valign: "middle", shrink: true }),
      text(420, 132, 476, 88, t("studio.tpl.thankYou"), { font: FONTS.poppins, size: 60, bold: true, color: ink, valign: "bottom", shrink: true }),
      text(420, 230, 476, 44, copy(t, "questions"), { font: FONTS.inter, size: 16, color: muted, lineHeight: 1.35, shrink: true }),
      box("rect", 420, 290, 64, 5, gradient(0, [accent, warm]), { radius: 2.5 }),
      ...contacts.flatMap((key, index) => {
        const y = 318 + index * 38;
        return [
          box("ellipse", 420, y + 5, 12, 12, solid(accent)),
          text(444, y, 452, 22, t(key), { font: FONTS.inter, size: 14, color: ink, valign: "middle", shrink: true }),
        ];
      }),
      text(420, SH - 40, 300, 14, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 9, bold: true, color: ink, shrink: true }),
    ]),
  ]);
}

function editorialDeck({ t }: TemplateContext) {
  const night = "#12100e";
  const ivory = "#f5efe6";
  const gold = "#c8a165";
  const muted = "#a8a29e";
  const line = "#3a332c";
  const golden = { primary: gold, secondary: gold };
  const backdrop = radial("#221d18", night, { cx: 0.3, cy: 0.3, radius: 1.1 });
  const numerals = ["I", "II", "III", "IV"];
  const captions = [1, 2, 3];
  const steps = [1, 2, 3, 4];
  const gallery = (SW - 128 - 48) / 3;
  const span = (SW - 128) / 4;
  const contacts = ["studio.tpl.email", "studio.tpl.website", "studio.tpl.phone"];
  return design(t("studio.templates.items.editorialDeck"), [gold, night, ivory], [
    pageOf(SLIDE, backdrop, [
      art("marble", { primary: "#3a332c", secondary: gold }, 0, 0, SW / 2, SH, { opacity: 0.12 }),
      ...framedPhoto(SW / 2, 0, SW / 2, SH, "#2a2520", "lifted", "none", "#000000"),
      box("rect", SW / 2 + 24, 24, SW / 2 - 48, SH - 48, NONE, { stroke: stroke(gold, 0.8) }),
      text(64, 64, 360, 14, copy(t, "edKicker"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      art("diamondDivider", golden, 64, 92, 120, 10),
      text(64, 150, 380, 214, copy(t, "edTitle"), { font: FONTS.cormorant, size: 68, bold: true, color: ivory, lineHeight: 0.98, valign: "bottom", shrink: true }),
      box("rect", 64, 382, 96, 1.6, foil("gold", 0)),
      text(64, 398, 360, 44, copy(t, "edSubtitle"), { font: FONTS.josefin, size: 12, color: muted, lineHeight: 1.5, shrink: true }),
      text(64, SH - 64, 360, 14, t("studio.tpl.companyName"), { font: FONTS.josefin, size: 9, bold: true, color: gold, upper: true, spacing: 3, shrink: true }),
    ]),
    pageOf(SLIDE, backdrop, [
      art("topographic", { primary: "#3a332c", secondary: gold }, 0, 0, SW, SH, { opacity: 0.08 }),
      box("rect", 24, 24, SW - 48, SH - 48, NONE, { stroke: stroke("#4a4038", 0.8) }),
      text(64, 64, 300, 14, copy(t, "contents"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      text(64, 92, 360, 150, copy(t, "edContentsTitle"), { font: FONTS.cormorant, size: 48, color: ivory, lineHeight: 1.04, shrink: true }),
      box("rect", 64, 270, 80, 1.6, foil("gold", 0)),
      ...numerals.flatMap((numeral, index) => {
        const y = 86 + index * 96;
        return [
          text(520, y, 72, 50, numeral, { font: FONTS.cormorant, size: 38, italic: true, color: gold, valign: "middle" }),
          text(600, y + 10, 230, 32, copy(t, `edItem${index + 1}`), { font: FONTS.cormorant, size: 25, color: ivory, valign: "middle", shrink: true }),
          text(836, y + 18, 60, 16, `0${index + 2}`, { font: FONTS.josefin, size: 10, color: muted, align: "right", spacing: 2 }),
          rule(520, y + 72, SW - 584, line, 0.8),
        ];
      }),
    ]),
    pageOf(SLIDE, radial("#2a241e", "#14110f", { cy: 0.45, radius: 0.9 }), [
      art("guillocheRosette", golden, SW / 2 - 230, SH / 2 - 230, 460, 460, { opacity: 0.08 }),
      box("rect", 24, 24, SW - 48, SH - 48, NONE, { stroke: stroke("#4a4038", 0.8) }),
      text(SW / 2 - 60, 46, 120, 140, "“", { font: FONTS.cormorant, size: 150, bold: true, color: gold, align: "center", lineHeight: 1 }),
      centredText(SLIDE_PAGE, 176, 180, copy(t, "edQuote"), { font: FONTS.cormorant, size: 40, italic: true, color: ivory, lineHeight: 1.18, valign: "middle", shrink: true, inset: 120 }),
      box("rect", SW / 2 - 36, 380, 72, 1.6, foil("gold", 0)),
      centredText(SLIDE_PAGE, 396, 20, t("studio.tpl.personName"), { font: FONTS.josefin, size: 12, bold: true, color: ivory, upper: true, spacing: 3, shrink: true }),
      centredText(SLIDE_PAGE, 420, 16, t("studio.tpl.jobTitle"), { font: FONTS.josefin, size: 10, color: muted, upper: true, spacing: 2, shrink: true }),
    ]),
    pageOf(SLIDE, backdrop, [
      text(64, 46, 480, 50, copy(t, "edItem2"), { font: FONTS.cormorant, size: 40, color: ivory, shrink: true }),
      text(SW - 364, 64, 300, 16, copy(t, "edKicker"), { font: FONTS.josefin, size: 10, bold: true, color: gold, align: "right", upper: true, spacing: 3, shrink: true }),
      box("rect", 64, 100, 64, 1.4, foil("gold", 0)),
      ...captions.flatMap((number, index) => {
        const x = 64 + index * (gallery + 24);
        const top = index === 1 ? 120 : 140;
        return [
          ...framedPhoto(x, top, gallery, 448 - top, index === 1 ? "#332d27" : "#2a2520", "lifted", "none", "#000000"),
          text(x, 464, 40, 24, `0${number}`, { font: FONTS.josefin, size: 10, bold: true, color: gold, spacing: 2, valign: "middle" }),
          text(x + 40, 462, gallery - 40, 28, copy(t, `edCaption${number}`), { font: FONTS.cormorant, size: 21, italic: true, color: ivory, valign: "middle", shrink: true }),
        ];
      }),
    ]),
    pageOf(SLIDE, backdrop, [
      art("topographic", { primary: "#3a332c", secondary: gold }, 0, 0, SW, SH, { opacity: 0.08 }),
      text(64, 64, 400, 14, copy(t, "edItem4"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      text(64, 88, 640, 56, copy(t, "edTimelineTitle"), { font: FONTS.cormorant, size: 44, color: ivory, shrink: true }),
      box("rect", 64, 289, SW - 128, 1.4, foil("gold", 0)),
      ...steps.flatMap((number, index) => {
        const x = 64 + index * span;
        const last = index === steps.length - 1;
        return [
          text(x, 222, span - 20, 44, copy(t, `edStep${number}When`), { font: FONTS.cormorant, size: 30, italic: true, color: gold, valign: "bottom", shrink: true }),
          shadowed(box("ellipse", x, 281, 18, 18, last ? foil("gold", 135) : solid(night), { stroke: stroke(gold, 1.5) }), "glow", gold),
          text(x, 318, span - 28, 22, copy(t, `edStep${number}`), { font: FONTS.josefin, size: 12.5, bold: true, color: ivory, upper: true, spacing: 1, shrink: true }),
          text(x, 346, span - 28, 72, copy(t, `edStep${number}Note`), { font: FONTS.josefin, size: 11.5, color: muted, lineHeight: 1.45, shrink: true }),
        ];
      }),
    ]),
    pageOf(SLIDE, backdrop, [
      art("marble", { primary: "#3a332c", secondary: gold }, 400, 0, SW - 400, SH, { opacity: 0.1 }),
      ...framedPhoto(0, 0, 400, SH, "#2a2520", "lifted", "none", "#000000"),
      box("rect", 24, 24, 352, SH - 48, NONE, { stroke: stroke(gold, 0.8) }),
      text(464, 120, 432, 160, copy(t, "edClosing"), { font: FONTS.cormorant, size: 54, color: ivory, lineHeight: 1.04, valign: "bottom", shrink: true }),
      box("rect", 464, 302, 96, 1.6, foil("gold", 0)),
      text(464, 324, 432, 18, t("studio.tpl.personName"), { font: FONTS.josefin, size: 12, bold: true, color: ivory, upper: true, spacing: 2, shrink: true }),
      text(464, 346, 432, 16, t("studio.tpl.jobTitle"), { font: FONTS.josefin, size: 10, color: muted, upper: true, spacing: 2, shrink: true }),
      ...contacts.map((key, index) => text(464, 392 + index * 24, 432, 18, t(key), { font: FONTS.josefin, size: 12, color: ivory, shrink: true })),
    ]),
  ]);
}

function plannerCover({ t }: TemplateContext) {
  const { width, height } = sizeOf(A5);
  const gold = "#d4b76a";
  const cream = "#f6f0e1";
  const green = "#1f3b2d";
  const band = width - 60;
  const centre = band / 2;
  const golden = { primary: gold, secondary: "#a8873f" };
  return design(t("studio.templates.items.plannerCover"), [green, gold, cream], [
    pageOf(A5, gradient(160, ["#2a5242", "#1d3b2f", "#122a20"]), [
      art("topographic", { primary: "#3f6b58", secondary: gold }, 0, 0, width, height, { opacity: 0.16 }),
      frame("gemFrame", golden, { width, height }),
      shadowed(box("rect", band, 0, 18, height, gradient(90, ["#0a1711", "#1a3328", "#0a1711"])), "long", "#000000"),
      text(centre - 140, 64, 280, 16, copy(t, "plannerLine"), { font: FONTS.josefin, size: 9.5, bold: true, color: gold, align: "center", upper: true, spacing: 3.5, shrink: true }),
      art("laurel", golden, centre - 88, 120, 176, 168),
      text(centre - 70, 168, 140, 72, "2027", { font: FONTS.cinzel, size: 36, bold: true, color: cream, align: "center", valign: "middle" }),
      text(centre - 150, 306, 300, 72, copy(t, "planner"), { font: FONTS.greatVibes, size: 60, color: cream, align: "center", valign: "middle", shrink: true }),
      art("flourishDivider", golden, centre - 80, 384, 160, 20),
      shadowed(box("rect", centre - 124, 432, 248, 100, solid(cream), { radius: 12 }), "lifted", "#000000"),
      box("rect", centre - 116, 440, 232, 84, NONE, { radius: 8, stroke: stroke(gold, 0.8) }),
      text(centre - 104, 452, 208, 14, copy(t, "belongsTo"), { font: FONTS.josefin, size: 8.5, bold: true, color: green, align: "center", upper: true, spacing: 1.6, shrink: true }),
      rule(centre - 96, 490, 192, "#a8a29e", 0.8),
      rule(centre - 96, 512, 192, "#a8a29e", 0.8),
    ]),
  ]);
}

function portfolioCover({ t }: TemplateContext) {
  const ink = "#111111";
  const lime = "#c6f432";
  const margin = 44;
  const inner = W - margin * 2;
  const side = inner - 316;
  const third = inner / 3;
  const tag = (x: number, y: number, value: string): StudioElement[] => [box("rect", x, y, 30, 18, solid(ink)), text(x, y, 30, 18, value, { font: FONTS.inter, size: 8.5, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 1 })];
  return design(t("studio.templates.items.portfolioCover"), [ink, lime, "#f4f3ee"], [
    pageOf(A4, solid("#f4f3ee"), [
      text(margin, 44, 250, 14, t("studio.tpl.website"), { font: FONTS.inter, size: 9, bold: true, color: ink, upper: true, spacing: 1, shrink: true }),
      text(W - margin - 250, 44, 250, 14, copy(t, "selectedWorks"), { font: FONTS.inter, size: 9, bold: true, color: ink, align: "right", upper: true, spacing: 1, shrink: true }),
      rule(margin, 68, inner, ink, 1.2),
      text(margin, 76, inner, 132, copy(t, "portfolio"), { font: FONTS.bebas, size: 140, color: ink, lineHeight: 0.92, spacing: 2, valign: "middle", shrink: true }),
      art("halftone", { primary: ink, secondary: ink }, margin - 24, 240, 220, 376, { opacity: 0.5 }),
      ...framedPhoto(margin, 216, 300, 380, "#dcdad2", "lifted"),
      ...framedPhoto(margin + 316, 216, side, 182, "#e6e4dc", "soft"),
      ...framedPhoto(margin + 316, 414, side, 182, "#d2d0c6", "soft"),
      ...tag(margin + 12, 228, "01"),
      ...tag(margin + 328, 228, "02"),
      ...tag(margin + 328, 426, "03"),
      box("ellipse", margin + 248, 520, 128, 128, NONE, { stroke: stroke(ink, 1) }),
      shadowed(box("ellipse", margin + 256, 528, 112, 112, solid(lime)), "long"),
      text(margin + 266, 558, 92, 52, copy(t, "portfolioBadge"), { font: FONTS.bebas, size: 19, color: ink, align: "center", valign: "middle", lineHeight: 1, rotation: -12, shrink: true }),
      text(margin, 664, inner - 160, 40, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 30, bold: true, color: ink, shrink: true }),
      text(margin, 706, 320, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 12, color: "#4b5563", shrink: true }),
      box("rect", W - margin - 64, 672, 64, 32, solid(lime), { radius: 16 }),
      box("rect", W - margin - 52, 687, 26, 2, solid(ink)),
      box("triangle", W - margin - 28, 682, 10, 12, solid(ink), { rotation: 90 }),
      rule(margin, 748, inner, ink, 1.2),
      text(margin, 758, third, 14, t("studio.tpl.email"), { font: FONTS.inter, size: 9, color: ink, shrink: true }),
      text(margin + third, 758, third, 14, t("studio.tpl.phone"), { font: FONTS.inter, size: 9, color: ink, align: "center", shrink: true }),
      text(margin + third * 2, 758, third, 14, t("studio.tpl.website"), { font: FONTS.inter, size: 9, color: ink, align: "right", shrink: true }),
    ]),
  ]);
}

type Tile = { column: number; row: number; background: string; motif: "circle" | "quarter" | "corner" | "ring" | "diamond" | "half" | "triangle" | "dot" | "flipped"; color: string; texture?: "halftone" | "diagonalHatch" | "topographic" };

function tileShapes(tile: Tile, side: number): StudioElement[] {
  const x = tile.column * side;
  const y = tile.row * side;
  const fill = solid(tile.color);
  const base = box("rect", x, y, side, side, solid(tile.background));
  const texture = tile.texture ? [art(tile.texture, { primary: tile.color, secondary: tile.color }, x, y, side, side, { opacity: 0.35 })] : [];
  const motif = (): StudioElement => {
    switch (tile.motif) {
      case "circle":
        return box("ellipse", x + 16, y + 16, side - 32, side - 32, fill);
      case "quarter":
        return box("ellipse", x, y, side * 2, side * 2, fill);
      case "corner":
        return box("rightTriangle", x, y, side, side, fill);
      case "flipped":
        return box("rightTriangle", x, y, side, side, fill, { rotation: 180 });
      case "ring":
        return box("ellipse", x + 26, y + 26, side - 52, side - 52, NONE, { stroke: stroke(tile.color, 14) });
      case "diamond":
        return box("diamond", x + 22, y + 22, side - 44, side - 44, fill);
      case "half":
        return box("rect", x, y + side / 2, side, side / 2, fill);
      case "triangle":
        return box("triangle", x + 20, y + 24, side - 40, side - 44, fill);
      case "dot":
        return box("ellipse", x + side / 2 - 26, y + side / 2 - 26, 52, 52, fill);
    }
  };
  return [base, ...texture, motif()];
}

function impactReport({ t }: TemplateContext) {
  const forest = "#14532d";
  const green = "#15803d";
  const mint = "#bbf7d0";
  const sand = "#fde68a";
  const cream = "#fefce8";
  const orange = "#f97316";
  const teal = "#0f766e";
  const side = W / 4;
  const margin = 48;
  const inner = W - margin * 2;
  const tiles: Tile[] = [
    { column: 0, row: 0, background: forest, motif: "circle", color: mint },
    { column: 1, row: 0, background: sand, motif: "quarter", color: orange, texture: "halftone" },
    { column: 2, row: 0, background: mint, motif: "corner", color: green },
    { column: 3, row: 0, background: cream, motif: "ring", color: forest, texture: "topographic" },
    { column: 0, row: 1, background: orange, motif: "diamond", color: cream, texture: "diagonalHatch" },
    { column: 3, row: 1, background: green, motif: "quarter", color: sand },
    { column: 0, row: 2, background: cream, motif: "half", color: teal },
    { column: 1, row: 2, background: forest, motif: "triangle", color: sand, texture: "halftone" },
    { column: 2, row: 2, background: sand, motif: "dot", color: orange },
    { column: 3, row: 2, background: teal, motif: "flipped", color: mint },
  ];
  return design(t("studio.templates.items.impactReport"), [forest, green, orange, sand], [
    pageOf(A4, solid("#ffffff"), [
      ...tiles.slice(0, 5).flatMap((tile) => tileShapes(tile, side)),
      ...framedPhoto(side, side, side * 2, side, "#d9f99d", "soft"),
      ...tiles.slice(5).flatMap((tile) => tileShapes(tile, side)),
      text(margin, 486, inner - 210, 14, copy(t, "impactKicker"), { font: FONTS.montserrat, size: 10, bold: true, color: green, upper: true, spacing: 3, shrink: true }),
      text(margin, 508, inner - 210, 116, t("studio.tpl.reportTitle"), { font: FONTS.montserrat, size: 46, bold: true, color: forest, lineHeight: 1.04, shrink: true }),
      text(W - margin - 200, 500, 200, 110, "2027", { font: FONTS.bebas, size: 104, color: green, align: "right", lineHeight: 1, valign: "middle", shrink: true }),
      box("rect", margin, 640, 64, 6, gradient(0, [orange, sand]), { radius: 3 }),
      text(margin, 660, inner - 40, 50, copy(t, "impactSubtitle"), { font: FONTS.inter, size: 15, color: "#374151", lineHeight: 1.4, shrink: true }),
      box("rect", 0, H - 72, W, 72, solid(forest)),
      art("waves", { primary: green, secondary: mint }, W / 2 - 150, H - 72, 300, 72, { opacity: 0.3 }),
      text(margin, H - 46, 300, 20, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(W - margin - 240, H - 46, 240, 20, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: mint, align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function annualReport({ t }: TemplateContext) {
  const palette = PALETTES.cobaltSun;
  const { ink, accent, accent2, muted, soft, paper } = palette;
  const margin = 48;
  const inner = W - margin * 2;
  const base = 690;
  const heights = [70, 104, 92, 150, 196, 252];
  const bar = 62;
  const gap = 22;
  const column = inner / 3;
  return design(t("studio.templates.items.annualReport"), paletteList(palette), [
    pageOf(A4, solid(paper), [
      box("ellipse", W - 250, -150, 420, 420, solid(soft)),
      art("diagonalHatch", { primary: "#c7d3f5", secondary: "#c7d3f5" }, W - 170, 0, 170, 230, { opacity: 0.5 }),
      text(margin, 40, 300, 20, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 11, bold: true, color: ink, upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(W - margin - 200, 40, 200, 20, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: muted, align: "right", valign: "middle", shrink: true }),
      rule(margin, 72, inner, ink, 1),
      text(margin, 100, 320, 20, t("studio.tpl.reportTitle"), { font: FONTS.poppins, size: 13, bold: true, color: accent, upper: true, spacing: 4, valign: "middle", shrink: true }),
      text(margin - 4, 122, 420, 136, "2027", { font: FONTS.poppins, size: 124, bold: true, color: accent, lineHeight: 1, valign: "middle" }),
      text(margin, 270, 420, 112, t("studio.tpl.annualReportTitle"), { font: FONTS.poppins, size: 40, bold: true, color: ink, lineHeight: 1.08, shrink: true }),
      text(margin, 392, 340, 44, t("studio.tpl.reportSubtitle"), { font: FONTS.inter, size: 13, color: muted, lineHeight: 1.45, shrink: true }),
      ...[1, 2, 3, 4].map((step) => rule(margin, base - step * 60, bar * 6 + gap * 5, "#cfd6ea", 0.8, "dotted")),
      ...heights.flatMap((height, index) => {
        const x = margin + index * (bar + gap);
        const last = index === heights.length - 1;
        return [
          shadowed(box("rect", x, base - height, bar, height, last ? gradient(180, [accent2, "#e08e00"]) : gradient(180, [index % 2 ? "#3b6cf0" : accent, "#1e3a8a"]), { radius: 6 }), last ? "lifted" : "soft"),
          text(x, base + 8, bar, 16, String(2022 + index), { font: FONTS.inter, size: 9, bold: last, color: last ? ink : muted, align: "center", valign: "middle" }),
        ];
      }),
      shadowed(box("rect", margin + 5 * (bar + gap) - 12, base - 252 - 42, bar + 24, 30, solid(ink), { radius: 15 }), "soft"),
      text(margin + 5 * (bar + gap) - 12, base - 252 - 42, bar + 24, 30, copy(t, "stat1Value"), { font: FONTS.poppins, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      rule(margin, base, bar * 6 + gap * 5, ink, 1.4),
      box("rect", 0, 732, W, H - 732, gradient(160, [ink, "#13265a"])),
      art("topographic", { primary: "#2b3f78", secondary: accent }, 0, 732, W, H - 732, { opacity: 0.35 }),
      box("rect", 0, 732, W, 4, gradient(0, [accent, accent2])),
      ...[1, 2, 3].flatMap((number, index) => {
        const x = margin + index * column;
        return [
          ...(index ? [vrule(x - 14, 756, 52, "#33457a", 1)] : []),
          text(x, 752, column - 28, 36, copy(t, `stat${number}Value`), { font: FONTS.poppins, size: 26, bold: true, color: index === 0 ? accent2 : "#ffffff", valign: "middle", shrink: true }),
          text(x, 790, column - 28, 18, copy(t, `stat${number}Label`), { font: FONTS.inter, size: 10.5, color: "#c7d0e8", valign: "middle", shrink: true }),
        ];
      }),
    ]),
  ]);
}

function guideEbook({ t }: TemplateContext) {
  const { width, height } = EBOOK;
  const page = { width, height };
  const paper = "#f4ece0";
  const clay = "#b85c38";
  const rust = "#8a3f22";
  const olive = "#5f6b3a";
  const ink = "#2e1d16";
  return design(t("studio.templates.items.guideEbook"), [clay, olive, ink, paper], [
    pageOf(EBOOK, solid(paper), [
      art("halftone", { primary: clay, secondary: olive }, 0, 0, width, height, { opacity: 0.06 }),
      box("ellipse", 78, 54, 344, 344, solid(olive)),
      box("rect", 78, 226, 344, 260, solid(olive)),
      box("ellipse", 92, 68, 316, 316, solid(clay)),
      box("rect", 92, 226, 316, 246, solid(clay)),
      art("sunburst", { primary: "#f2c48d", secondary: "#f2c48d" }, 92, 68, 316, 404, { opacity: 0.16 }),
      shadowed(box("ellipse", 190, 150, 120, 120, gradient(180, ["#f7d6a6", "#efb878"])), "glow", "#f7d6a6"),
      box("ellipse", 92, 372, 240, 160, solid("#7b8549")),
      box("ellipse", 236, 396, 172, 140, solid("#4f5a2e")),
      box("rect", 60, 486, 380, 60, solid(paper)),
      box("rect", 78, 472, 344, 14, solid(olive)),
      art("botanicalSprig", { primary: olive, secondary: clay }, 36, 340, 84, 168, { rotation: -16 }),
      art("botanicalSprig", { primary: olive, secondary: clay }, 392, 360, 64, 128, { rotation: 18, opacity: 0.85 }),
      shadowed(box("ellipse", 372, 34, 104, 104, solid(ink)), "lifted", "#2e1d16"),
      box("ellipse", 380, 42, 88, 88, { type: "none" }, { stroke: stroke("#f2c48d", 1, "dashed") }),
      text(388, 62, 72, 48, t("studio.tpl.guideEbookBadge"), { font: FONTS.josefin, size: 12, bold: true, color: paper, align: "center", valign: "middle", upper: true, spacing: 1, shrink: true }),
      centredText(page, 504, 20, t("studio.tpl.guideEbookKicker"), { font: FONTS.josefin, size: 12, bold: true, color: rust, upper: true, spacing: 4, valign: "middle", shrink: true, inset: 40 }),
      centredText(page, 528, 116, t("studio.tpl.guideEbookTitle"), { font: FONTS.abril, size: 44, color: ink, lineHeight: 1.08, valign: "middle", shrink: true, inset: 36 }),
      centredText(page, 650, 42, t("studio.tpl.guideEbookSubtitle"), { font: FONTS.josefin, size: 14, color: "#5c4a3e", lineHeight: 1.35, shrink: true, inset: 56 }),
      art("diamondDivider", { primary: clay, secondary: olive }, width / 2 - 60, 702, 120, 10),
      centredText(page, 722, 22, t("studio.tpl.personName"), { font: FONTS.josefin, size: 14, bold: true, color: ink, upper: true, spacing: 3, valign: "middle", shrink: true }),
      centredText(page, 752, 18, t("studio.tpl.guideEbookFooter"), { font: FONTS.josefin, size: 10, bold: true, color: rust, upper: true, spacing: 2, valign: "middle", shrink: true }),
    ]),
  ]);
}

function fashionMagazine({ t }: TemplateContext) {
  const gold = "#e3c58d";
  const lines = [1, 2, 3];
  return design(t("studio.templates.items.fashionMagazine"), ["#1c1916", gold, "#f5efe6"], [
    pageOf(A4, solid("#2a2622"), [
      ...framedPhoto(0, 0, W, H, "#3a3530", "soft"),
      ...Array.from({ length: 10 }, (_, index) => box("rect", 0, index * 22, W, 22, solid("#000000"), { opacity: Math.round(((10 - index) / 10) * 0.55 * 100) / 100 })),
      ...Array.from({ length: 8 }, (_, index) => box("rect", index * 34, 262, 34, 300, solid("#000000"), { opacity: Math.round(((8 - index) / 8) * 0.4 * 100) / 100 })),
      ...fade(0, H - 372, W, 12, 9, "#000000", 0.72),
      box("rect", 0, H - 264, W, 264, solid("#000000"), { opacity: 0.72 }),
      box("rect", 18, 18, W - 36, H - 36, NONE, { stroke: stroke(gold, 0.8) }),
      centredText(PAGE, 34, 132, t("studio.tpl.fashionMagazineName"), { font: FONTS.cormorant, size: 116, bold: true, color: "#ffffff", spacing: 10, upper: true, lineHeight: 1, valign: "middle", shrink: true, inset: 32 }),
      box("rect", W / 2 - 110, 174, 220, 1.2, foil("gold", 0)),
      centredText(PAGE, 184, 18, t("studio.tpl.fashionMagazineIssue"), { font: FONTS.josefin, size: 9.5, bold: true, color: "#ffffff", upper: true, spacing: 4, valign: "middle", shrink: true }),
      ...lines.flatMap((number, index) => {
        const y = 284 + index * 86;
        return [
          text(40, y, 60, 24, `0${number}`, { font: FONTS.cormorant, size: 22, italic: true, bold: true, color: gold, valign: "middle" }),
          text(40, y + 26, 226, 54, t(`studio.tpl.fashionMagazineLine${number}`), { font: FONTS.cormorant, size: 23, bold: true, color: "#ffffff", lineHeight: 1.1, shrink: true }),
          ...(index < lines.length - 1 ? [rule(40, y + 80, 28, gold, 1)] : []),
        ];
      }),
      text(W - 184, 412, 300, 16, t("studio.tpl.fashionMagazineTagline"), { font: FONTS.josefin, size: 9, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 5, rotation: 90, shrink: true }),
      text(40, H - 294, 200, 18, copy(t, "coverStory"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, valign: "middle", shrink: true }),
      text(40, H - 276, W - 80, 156, t("studio.tpl.fashionMagazineHeadline"), { font: FONTS.cormorant, size: 76, bold: true, italic: true, color: "#ffffff", lineHeight: 1, valign: "bottom", shrink: true }),
      box("rect", 40, H - 112, 64, 1.6, foil("gold", 0)),
      text(40, H - 100, W - 180, 48, t("studio.tpl.fashionMagazineDeck"), { font: FONTS.josefin, size: 11.5, color: "#ede6dc", lineHeight: 1.45, shrink: true }),
      text(40, H - 44, 300, 16, t("studio.tpl.website"), { font: FONTS.josefin, size: 9, bold: true, color: gold, upper: true, spacing: 2, valign: "middle", shrink: true }),
      art("diamondDivider", { primary: gold, secondary: gold }, W - 160, H - 40, 120, 8),
    ]),
  ]);
}

function studioPortfolio({ t }: TemplateContext) {
  const palette = PALETTES.mochaCream;
  const { ink, accent2 } = palette;
  const margin = 48;
  const inner = W - margin * 2;
  const top = 420;
  const tags = [1, 2, 3];
  return design(t("studio.templates.items.studioPortfolio"), paletteList(palette), [
    pageOf(A4, solid("#f3eee7"), [
      art("halftone", { primary: accent2, secondary: accent2 }, 0, 0, W, top, { opacity: 0.12 }),
      ...framedPhoto(40, 40, 248, 352, "#d9cbbd", "soft", "rounded"),
      ...framedPhoto(304, 40, W - 344, 168, "#e4d8cb", "soft", "rounded"),
      ...framedPhoto(304, 224, (W - 360) / 2, 168, "#cfbfae", "soft", "rounded"),
      ...framedPhoto(320 + (W - 360) / 2, 224, (W - 360) / 2, 168, "#e0d2c3", "soft", "rounded"),
      box("rect", 0, top, W, H - top, gradient(160, ["#3a2a20", ink])),
      art("arcRings", { primary: accent2, secondary: "#8a6a50" }, W - 240, 500, 280, 280, { opacity: 0.3 }),
      shadowed(box("ellipse", W - 148, top - 48, 96, 96, solid(accent2), { stroke: stroke("#f3eee7", 4) }), "lifted", "#000000"),
      text(W - 140, top - 22, 80, 44, "2027", { font: FONTS.raleway, size: 17, bold: true, color: ink, align: "center", valign: "middle", spacing: 1 }),
      text(margin, 452, 320, 16, copy(t, "selectedWorks"), { font: FONTS.raleway, size: 10, bold: true, color: accent2, upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(margin - 4, 474, 400, 100, copy(t, "portfolio"), { font: FONTS.playfair, size: 80, italic: true, color: "#f3e3cf", lineHeight: 1.1, valign: "middle", shrink: true }),
      box("rect", margin, 590, 80, 2, foil("gold", 0)),
      text(margin, 608, 400, 36, t("studio.tpl.personName"), { font: FONTS.raleway, size: 24, bold: true, color: "#ffffff", upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(margin, 648, 400, 20, t("studio.tpl.jobTitle"), { font: FONTS.raleway, size: 13, color: "#d9c7b5", valign: "middle", shrink: true }),
      text(margin, 676, 330, 40, t("studio.tpl.studioPortfolioLead"), { font: FONTS.raleway, size: 11, color: "#bfae9d", lineHeight: 1.45, shrink: true }),
      ...tags.flatMap((number, index) => {
        const x = margin + index * 114;
        return [box("rect", x, 734, 104, 28, NONE, { radius: 14, stroke: stroke(accent2, 1) }), text(x + 8, 734, 88, 28, t(`studio.tpl.studioPortfolioTag${number}`), { font: FONTS.raleway, size: 9.5, bold: true, color: accent2, align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true })];
      }),
      rule(margin, 790, inner, "#5a4537", 0.8),
      text(margin, 802, inner / 2, 18, t("studio.tpl.email"), { font: FONTS.raleway, size: 9.5, color: "#d9c7b5", valign: "middle", shrink: true }),
      text(margin + inner / 2, 802, inner / 2, 18, t("studio.tpl.website"), { font: FONTS.raleway, size: 9.5, color: "#d9c7b5", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function researchThesis({ t }: TemplateContext) {
  const palette = PALETTES.emeraldBrass;
  const { ink, accent, accent2, muted, paper } = palette;
  const brass = "#d9bf8c";
  const goldInk = darker(accent2, 0.5);
  const band = 196;
  const left = band + 40;
  const column = W - left - 48;
  const person = (y: number, label: string, name: string, detail: string): StudioElement[] => [
    text(left, y, column, 14, label, { font: FONTS.montserrat, size: 9, bold: true, color: goldInk, upper: true, spacing: 2, valign: "middle", shrink: true }),
    text(left, y + 18, column, 24, name, { font: FONTS.sourceSerif, size: 16, bold: true, color: ink, valign: "middle", shrink: true }),
    text(left, y + 44, column, 16, detail, { font: FONTS.montserrat, size: 10, color: muted, valign: "middle", shrink: true }),
  ];
  return design(t("studio.templates.items.researchThesis"), paletteList(palette), [
    pageOf(A4, radial(paper, "#ebe6d8", { cx: 0.7, cy: 0.4, radius: 1 }), [
      art("guillocheRosette", { primary: accent, secondary: accent2 }, W - 300, H - 320, 400, 400, { opacity: 0.07 }),
      box("rect", 0, 0, band, H, gradient(170, [accent, "#082a20"])),
      art("topographic", { primary: "#2f7a62", secondary: accent2 }, 0, 0, band, H, { opacity: 0.25 }),
      box("rect", band, 0, 4, H, foil("gold", 90)),
      art("laurel", { primary: brass, secondary: brass }, band / 2 - 62, 64, 124, 118),
      shadowed(art("shield", { primary: brass, secondary: accent }, band / 2 - 22, 92, 44, 56), "soft"),
      text(20, 200, band - 40, 56, copy(t, "universityName"), { font: FONTS.sourceSerif, size: 16, bold: true, color: paper, align: "center", lineHeight: 1.25, valign: "middle", shrink: true }),
      rule(band / 2 - 20, 270, 40, brass, 1.2),
      art("guillocheRosette", { primary: brass, secondary: brass }, band / 2 - 64, H - 200, 128, 128, { opacity: 0.45 }),
      text(left, 70, column, 40, copy(t, "facultyName"), { font: FONTS.montserrat, size: 9.5, color: muted, lineHeight: 1.45, shrink: true }),
      rule(left, 124, 40, accent2, 1.4),
      text(left, 194, column, 22, t("studio.tpl.researchThesisType"), { font: FONTS.montserrat, size: 11, bold: true, color: goldInk, upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(left, 224, column, 160, t("studio.tpl.researchThesisTitle"), { font: FONTS.sourceSerif, size: 30, bold: true, color: ink, lineHeight: 1.18, shrink: true }),
      text(left, 400, column, 72, t("studio.tpl.researchThesisDegree"), { font: FONTS.sourceSerif, size: 12, italic: true, color: muted, lineHeight: 1.45, shrink: true }),
      art("diamondDivider", { primary: accent2, secondary: accent }, left, 500, 140, 10),
      ...person(560, copy(t, "preparedByLabel"), t("studio.tpl.personName"), `${t("studio.tpl.studentNumber")}: 210204012`),
      ...person(644, copy(t, "advisor"), copy(t, "advisorName"), copy(t, "advisorDept")),
      rule(left, H - 84, column, "#d3ccb8", 0.8),
      text(left, H - 72, column, 20, t("studio.tpl.researchThesisPlace"), { font: FONTS.montserrat, size: 10, bold: true, color: accent, upper: true, spacing: 2, valign: "middle", shrink: true }),
    ]),
  ]);
}

export const COVER_TEMPLATES: StudioTemplate[] = [
  { id: "assignmentCover", category: "covers", size: A4, build: assignmentCover },
  { id: "thesisCover", category: "covers", size: A4, build: thesisCover },
  { id: "bookCover", category: "covers", size: BOOK, build: bookCover },
  { id: "magazineCover", category: "covers", size: A4, build: magazineCover },
  { id: "ebookCover", category: "covers", size: EBOOK, build: ebookCover },
  { id: "businessDeck", category: "covers", size: SLIDE, build: businessDeck },
  { id: "editorialDeck", category: "covers", size: SLIDE, build: editorialDeck },
  { id: "plannerCover", category: "covers", size: A5, build: plannerCover },
  { id: "portfolioCover", category: "covers", size: A4, build: portfolioCover },
  { id: "impactReport", category: "covers", size: A4, build: impactReport },
  { id: "annualReport", category: "covers", size: A4, build: annualReport },
  { id: "guideEbook", category: "covers", size: EBOOK, build: guideEbook },
  { id: "fashionMagazine", category: "covers", size: A4, build: fashionMagazine },
  { id: "studioPortfolio", category: "covers", size: A4, build: studioPortfolio },
  { id: "researchThesis", category: "covers", size: A4, build: researchThesis },
];
