import type { StudioElement, StudioFill } from "@/types/studio";
import { art, box, centredText, design, FONTS, linear, pageOf, photoSlot, rule, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";

type Translate = TemplateContext["t"];

const A4 = "a4" as const;
const A5 = "a5" as const;
const SLIDE = "presentation" as const;
const BOOK = { width: 432, height: 648 };
const EBOOK = { width: 500, height: 800 };
const NONE: StudioFill = { type: "none" };
const { width: W, height: H } = sizeOf(A4);
const { width: SW, height: SH } = sizeOf(SLIDE);
const SLIDE_PAGE = { width: SW, height: SH };

function copy(t: Translate, key: string): string {
  return t(`studio.tpl.covers.${key}`);
}

function labelledLine(x: number, y: number, width: number, label: string, value: string, accent: string): StudioElement[] {
  return [
    text(x, y, width, 14, label, { font: FONTS.poppins, size: 8.5, bold: true, color: accent, upper: true, spacing: 1.2, shrink: true }),
    text(x, y + 17, width, 22, value, { font: FONTS.poppins, size: 13, color: "#0f172a", shrink: true }),
    rule(x, y + 46, width, "#cbd5e1", 0.8),
  ];
}

function assignmentCover({ t }: TemplateContext) {
  const deep = "#164e63";
  const teal = "#0e7490";
  const coral = "#fb7185";
  const margin = 56;
  const inner = W - margin * 2;
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
  return design(t("studio.templates.items.assignmentCover"), [teal, coral, deep], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, 320, linear(135, deep, teal)),
      art("arcRings", { primary: "#22d3ee", secondary: coral }, W - 190, -70, 260, 260, { opacity: 0.45 }),
      box("ellipse", W - 118, 236, 52, 52, solid(coral), { opacity: 0.9 }),
      box("rect", margin, 60, 116, 26, solid(coral), { radius: 13 }),
      text(margin, 60, 116, 26, copy(t, "assignment"), { font: FONTS.poppins, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(margin, 102, inner - 120, 20, t("studio.tpl.schoolName"), { font: FONTS.poppins, size: 13, bold: true, color: "#cffafe", shrink: true }),
      text(margin, 136, inner - 90, 124, copy(t, "assignmentTitle"), { font: FONTS.poppins, size: 34, bold: true, color: "#ffffff", lineHeight: 1.1, valign: "bottom", shrink: true }),
      text(margin, 266, inner - 90, 36, copy(t, "assignmentSubtitle"), { font: FONTS.inter, size: 12, color: "#a5f3fc", lineHeight: 1.35, shrink: true }),
      box("rect", margin, 352, inner, 286, solid("#f8fafc"), { radius: 16, stroke: stroke("#e2e8f0", 1) }),
      text(left, 372, inner - 48, 18, copy(t, "studentDetails"), { font: FONTS.poppins, size: 12, bold: true, color: deep, shrink: true }),
      ...fields.flatMap(([label, value], index) => labelledLine(index % 2 ? right : left, 410 + Math.floor(index / 2) * 74, column, label, value, teal)),
      text(margin, 664, 300, 14, copy(t, "teacherRemarks"), { font: FONTS.poppins, size: 8.5, bold: true, color: teal, upper: true, spacing: 1.2, shrink: true }),
      rule(margin, 702, 300, "#cbd5e1", 0.8, "dashed"),
      rule(margin, 728, 300, "#cbd5e1", 0.8, "dashed"),
      box("rect", W - margin - 120, 656, 120, 76, solid("#ffffff"), { radius: 12, stroke: stroke(teal, 1.2, "dashed") }),
      text(W - margin - 120, 664, 120, 14, t("studio.tpl.score"), { font: FONTS.poppins, size: 8.5, bold: true, color: teal, align: "center", upper: true, spacing: 1.2, shrink: true }),
      art("waves", { primary: teal, secondary: coral }, 0, H - 96, W, 96),
      centredText({ width: W }, H - 34, 16, t("studio.tpl.academicYear"), { font: FONTS.poppins, size: 10, bold: true, color: "#ffffff", spacing: 1, shrink: true }),
    ]),
  ]);
}

function thesisCover({ t }: TemplateContext) {
  const wine = "#7f1d1d";
  const gold = "#a16207";
  const ink = "#1c1917";
  const muted = "#57534e";
  const page = { width: W, height: H };
  const half = (W - 160) / 2;
  const person = (x: number, label: string, name: string, detail: string): StudioElement[] => [
    text(x, 572, half - 10, 14, label, { font: FONTS.cinzel, size: 9, bold: true, color: gold, align: "center", upper: true, spacing: 2, shrink: true }),
    text(x, 592, half - 10, 22, name, { font: FONTS.garamond, size: 15, bold: true, color: ink, align: "center", shrink: true }),
    text(x, 616, half - 10, 18, detail, { font: FONTS.garamond, size: 11, color: muted, align: "center", shrink: true }),
  ];
  return design(t("studio.templates.items.thesisCover"), [wine, gold], [
    pageOf(A4, solid("#fffdf7"), [
      box("rect", 26, 26, W - 52, H - 52, NONE, { stroke: stroke(wine, 2) }),
      box("rect", 33, 33, W - 66, H - 66, NONE, { stroke: stroke(gold, 0.6) }),
      art("laurel", { primary: gold, secondary: wine }, W / 2 - 58, 62, 116, 111),
      art("shield", { primary: wine, secondary: gold }, W / 2 - 21, 92, 42, 52),
      centredText(page, 188, 26, copy(t, "universityName"), { font: FONTS.cinzel, size: 19, bold: true, color: wine, shrink: true, inset: 60 }),
      centredText(page, 218, 36, copy(t, "facultyName"), { font: FONTS.garamond, size: 12, color: "#44403c", lineHeight: 1.4, shrink: true, inset: 70 }),
      art("diamondDivider", { primary: gold, secondary: wine }, W / 2 - 100, 270, 200, 14),
      centredText(page, 314, 18, copy(t, "thesisType"), { font: FONTS.cinzel, size: 12, bold: true, color: gold, spacing: 4, upper: true, shrink: true }),
      centredText(page, 342, 140, copy(t, "thesisTitle"), { font: FONTS.garamond, size: 30, bold: true, color: ink, lineHeight: 1.18, valign: "middle", shrink: true, inset: 70 }),
      centredText(page, 494, 40, copy(t, "thesisStatement"), { font: FONTS.garamond, size: 11.5, italic: true, color: muted, lineHeight: 1.4, shrink: true, inset: 96 }),
      ...person(80, copy(t, "preparedByLabel"), t("studio.tpl.personName"), `${t("studio.tpl.studentNumber")}: 210204012`),
      vrule(W / 2, 572, 62, "#d6d3d1", 0.8),
      ...person(W / 2 + 10, copy(t, "advisor"), copy(t, "advisorName"), copy(t, "advisorDept")),
      art("dotsDivider", { primary: gold, secondary: gold }, W / 2 - 60, H - 150, 120, 8),
      centredText(page, H - 126, 20, copy(t, "thesisPlace"), { font: FONTS.cinzel, size: 12, bold: true, color: wine, spacing: 2, shrink: true }),
    ]),
  ]);
}

function bookCover({ t }: TemplateContext) {
  const { width, height } = BOOK;
  const rust = "#c2410c";
  const ink = "#1c1917";
  const margin = 36;
  const inner = width - margin * 2;
  return design(t("studio.templates.items.bookCover"), [rust, ink], [
    pageOf(BOOK, solid("#f4ede1"), [
      text(margin, 34, inner, 16, copy(t, "authorName"), { font: FONTS.raleway, size: 11, bold: true, color: rust, align: "center", upper: true, spacing: 4, shrink: true }),
      text(margin, 62, inner, 132, copy(t, "bookTitle"), { font: FONTS.playfair, size: 50, bold: true, color: ink, align: "center", valign: "middle", lineHeight: 1.0, shrink: true }),
      art("flourishDivider", { primary: rust, secondary: ink }, width / 2 - 70, 202, 140, 18),
      ...photoSlot(margin, 236, inner, 300, "#e2d6c3"),
      box("ellipse", width - margin - 58, 206, 76, 76, solid(rust)),
      text(margin, 552, inner, 36, copy(t, "bookBlurb"), { font: FONTS.lora, size: 11.5, italic: true, color: "#44403c", align: "center", lineHeight: 1.35, shrink: true }),
      rule(margin, height - 46, inner, "#d6c7ae", 0.8),
      text(margin, height - 36, inner / 2, 16, copy(t, "bookGenre"), { font: FONTS.raleway, size: 9, bold: true, color: rust, upper: true, spacing: 2, shrink: true }),
      text(width / 2, height - 36, inner / 2, 16, copy(t, "publisher"), { font: FONTS.raleway, size: 9, bold: true, color: ink, align: "right", upper: true, spacing: 2, shrink: true }),
    ]),
  ]);
}

function magazineCover({ t }: TemplateContext) {
  const red = "#dc2626";
  const ink = "#0f172a";
  const yellow = "#facc15";
  const margin = 32;
  const inner = W - margin * 2;
  const lines = [1, 2, 3];
  return design(t("studio.templates.items.magazineCover"), [red, yellow, ink], [
    pageOf(A4, solid("#cbd5e1"), [
      ...photoSlot(0, 0, W, H, "#cbd5e1"),
      text(margin, 12, inner, 138, copy(t, "magazineName"), { font: FONTS.bebas, size: 132, color: red, align: "center", lineHeight: 1, spacing: 6, shrink: true }),
      rule(margin, 156, inner, ink, 1.2),
      text(margin, 163, inner, 16, copy(t, "issueLine"), { font: FONTS.oswald, size: 10, color: ink, align: "center", upper: true, spacing: 2, shrink: true }),
      rule(margin, 186, inner, ink, 1.2),
      ...lines.flatMap((number, index) => {
        const y = 214 + index * 84;
        return [
          box("rect", margin, y, 204, 70, solid("#ffffff"), { opacity: 0.9 }),
          box("rect", margin, y, 5, 70, solid(red)),
          text(margin + 16, y + 10, 176, 14, copy(t, `coverKicker${number}`), { font: FONTS.oswald, size: 10, bold: true, color: red, upper: true, spacing: 1.5, shrink: true }),
          text(margin + 16, y + 26, 176, 38, copy(t, `coverLine${number}`), { font: FONTS.playfair, size: 15, bold: true, color: ink, lineHeight: 1.15, shrink: true }),
        ];
      }),
      box("burst", W - 172, 206, 140, 140, solid(yellow), { points: 20, inner: 0.84, rotation: -12 }),
      text(W - 160, 244, 116, 64, copy(t, "magazineBadge"), { font: FONTS.oswald, size: 19, bold: true, color: ink, align: "center", valign: "middle", upper: true, lineHeight: 1.05, rotation: -12, shrink: true }),
      box("rect", 0, H - 290, W, 290, linear(180, "#1e293b", "#020617"), { opacity: 0.74 }),
      text(margin, H - 268, 260, 16, copy(t, "coverStory"), { font: FONTS.oswald, size: 11, bold: true, color: yellow, upper: true, spacing: 3, shrink: true }),
      text(margin, H - 246, inner - 40, 124, copy(t, "magazineHeadline"), { font: FONTS.abril, size: 50, color: "#ffffff", lineHeight: 1.04, valign: "bottom", shrink: true }),
      text(margin, H - 114, inner - 120, 44, copy(t, "magazineDeck"), { font: FONTS.inter, size: 12.5, color: "#e2e8f0", lineHeight: 1.4, shrink: true }),
      rule(margin, H - 58, inner, "#64748b", 0.8),
      text(margin, H - 48, inner - 180, 16, copy(t, "magazineMore"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", shrink: true }),
      text(W - margin - 170, H - 48, 170, 16, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: "#cbd5e1", align: "right", shrink: true }),
    ]),
  ]);
}

function ebookCover({ t }: TemplateContext) {
  const { width, height } = EBOOK;
  const peach = "#fdba74";
  const margin = 44;
  const inner = width - margin * 2;
  return design(t("studio.templates.items.ebookCover"), ["#4c1d95", "#db2777", peach], [
    pageOf(EBOOK, linear(160, "#2e1065", "#be185d"), [
      art("blob", { primary: "#f472b6", secondary: "#8b5cf6" }, 170, 330, 420, 420, { opacity: 0.55 }),
      box("ellipse", -120, 520, 360, 360, NONE, { stroke: stroke("#f9a8d4", 1.5), opacity: 0.5 }),
      box("ellipse", 330, 52, 120, 120, NONE, { stroke: stroke(peach, 1.5) }),
      box("ellipse", 372, 94, 36, 36, solid(peach)),
      box("rect", margin, 64, 150, 28, solid(peach), { radius: 14 }),
      text(margin, 64, 150, 28, copy(t, "ebookLabel"), { font: FONTS.montserrat, size: 10, bold: true, color: "#4c0519", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      text(margin, 150, inner, 260, copy(t, "ebookTitle"), { font: FONTS.montserrat, size: 52, bold: true, color: "#ffffff", lineHeight: 1.04, valign: "bottom", shrink: true }),
      box("rect", margin, 428, 64, 5, solid(peach), { radius: 2.5 }),
      text(margin, 450, inner - 60, 60, copy(t, "ebookSubtitle"), { font: FONTS.inter, size: 15, color: "#fce7f3", lineHeight: 1.4, shrink: true }),
      ...photoSlot(margin, 560, 88, 88, "#f9a8d4", "circle"),
      text(margin + 104, 580, 260, 22, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", shrink: true }),
      text(margin + 104, 604, 260, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 11, color: "#fbcfe8", shrink: true }),
      text(margin, height - 72, inner, 16, copy(t, "ebookFooter"), { font: FONTS.montserrat, size: 10, bold: true, color: peach, upper: true, spacing: 1.5, shrink: true }),
    ]),
  ]);
}

function deckFooter(t: Translate, number: string, brand: string, muted: string): StudioElement[] {
  return [
    text(64, SH - 40, 300, 14, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 9, bold: true, color: brand, shrink: true }),
    text(SW - 124, SH - 40, 60, 14, number, { font: FONTS.poppins, size: 9, color: muted, align: "right" }),
  ];
}

function businessDeck({ t }: TemplateContext) {
  const accent = "#ff5a36";
  const warm = "#ff8a5c";
  const ink = "#111827";
  const soft = "#fff4ef";
  const muted = "#6b7280";
  const agenda = [1, 2, 3, 4];
  const bullets = [1, 2, 3, 4];
  const stats = [1, 2, 3];
  const card = (SW - 128 - 48) / 3;
  const contacts = ["studio.tpl.email", "studio.tpl.phone", "studio.tpl.website"];
  return design(t("studio.templates.items.businessDeck"), [accent, ink, soft], [
    pageOf(SLIDE, solid("#ffffff"), [
      ...photoSlot(520, 0, 440, SH, "#fde0d6"),
      box("rect", 480, SH - 148, 148, 148, solid(accent)),
      box("rect", 64, 64, 28, 28, solid(accent), { radius: 6 }),
      text(102, 64, 300, 28, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 13, bold: true, color: ink, valign: "middle", shrink: true }),
      text(64, 150, 400, 150, copy(t, "deckTitle"), { font: FONTS.poppins, size: 46, bold: true, color: ink, lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 64, 316, 56, 5, solid(accent), { radius: 2.5 }),
      text(64, 336, 400, 50, copy(t, "deckSubtitle"), { font: FONTS.inter, size: 15, color: muted, lineHeight: 1.4, shrink: true }),
      text(64, 452, 360, 18, t("studio.tpl.personName"), { font: FONTS.poppins, size: 12, bold: true, color: ink, shrink: true }),
      text(64, 472, 360, 16, "{date}", { font: FONTS.inter, size: 11, color: muted }),
    ]),
    pageOf(SLIDE, solid(soft), [
      box("rect", 0, 0, 320, SH, solid(ink)),
      art("arcRings", { primary: accent, secondary: "#ffffff" }, 90, 330, 220, 220, { opacity: 0.6 }),
      text(64, 80, 230, 60, copy(t, "agenda"), { font: FONTS.poppins, size: 40, bold: true, color: "#ffffff", shrink: true }),
      box("rect", 64, 150, 56, 5, solid(accent), { radius: 2.5 }),
      text(64, 172, 220, 60, copy(t, "agendaLead"), { font: FONTS.inter, size: 13, color: "#d1d5db", lineHeight: 1.4, shrink: true }),
      ...agenda.flatMap((number, index) => {
        const y = 64 + index * 100;
        return [
          text(384, y, 84, 56, `0${number}`, { font: FONTS.poppins, size: 40, bold: true, color: accent, valign: "middle" }),
          text(480, y + 4, SW - 544, 26, copy(t, `agenda${number}`), { font: FONTS.poppins, size: 19, bold: true, color: ink, shrink: true }),
          text(480, y + 32, SW - 544, 18, copy(t, `agendaNote${number}`), { font: FONTS.inter, size: 11.5, color: muted, shrink: true }),
          ...(index < agenda.length - 1 ? [rule(384, y + 80, SW - 448, "#f3c9bb", 0.8)] : []),
        ];
      }),
      text(SW - 124, SH - 40, 60, 14, "02", { font: FONTS.poppins, size: 9, color: muted, align: "right" }),
    ]),
    pageOf(SLIDE, linear(135, accent, warm), [
      art("arcRings", { primary: "#ffffff", secondary: ink }, 600, 110, 320, 320, { opacity: 0.5 }),
      text(64, 80, 420, 220, "02", { font: FONTS.poppins, size: 190, bold: true, color: "#ffd2c2", lineHeight: 1, valign: "middle" }),
      text(64, 318, 600, 60, copy(t, "agenda2"), { font: FONTS.poppins, size: 40, bold: true, color: "#ffffff", shrink: true }),
      text(64, 384, 520, 50, copy(t, "sectionLead"), { font: FONTS.inter, size: 15, color: "#fff1eb", lineHeight: 1.4, shrink: true }),
      ...deckFooter(t, "03", "#ffffff", "#ffe4da"),
    ]),
    pageOf(SLIDE, solid("#ffffff"), [
      text(64, 54, 520, 16, copy(t, "contentKicker"), { font: FONTS.poppins, size: 10, bold: true, color: accent, upper: true, spacing: 2, shrink: true }),
      text(64, 74, 540, 50, copy(t, "contentTitle"), { font: FONTS.poppins, size: 30, bold: true, color: ink, shrink: true }),
      ...bullets.flatMap((number, index) => {
        const y = 156 + index * 64;
        return [
          box("ellipse", 64, y + 6, 12, 12, solid(accent)),
          text(92, y, 476, 54, copy(t, `bullet${number}`), { font: FONTS.inter, size: 15, color: ink, lineHeight: 1.4, shrink: true }),
        ];
      }),
      box("rect", 620, 140, 276, 300, solid(soft), { radius: 16 }),
      text(644, 152, 80, 80, "“", { font: FONTS.playfair, size: 80, bold: true, color: accent, lineHeight: 1 }),
      text(644, 228, 228, 140, copy(t, "calloutQuote"), { font: FONTS.playfair, size: 17, italic: true, color: ink, lineHeight: 1.35, shrink: true }),
      text(644, 392, 228, 18, copy(t, "calloutAuthor"), { font: FONTS.inter, size: 11, bold: true, color: accent, shrink: true }),
      ...deckFooter(t, "04", ink, muted),
    ]),
    pageOf(SLIDE, solid(soft), [
      ...photoSlot(64, 64, 400, 412, "#fbd3c5", "rounded"),
      box("rect", 424, 404, 80, 80, solid(accent), { radius: 12 }),
      text(544, 92, 352, 16, copy(t, "twoColKicker"), { font: FONTS.poppins, size: 10, bold: true, color: accent, upper: true, spacing: 2, shrink: true }),
      text(544, 114, 352, 90, copy(t, "twoColTitle"), { font: FONTS.poppins, size: 30, bold: true, color: ink, lineHeight: 1.12, shrink: true }),
      text(544, 218, 352, 150, copy(t, "twoColBody"), { font: FONTS.inter, size: 13.5, color: "#374151", lineHeight: 1.55, shrink: true }),
      ...[1, 2].flatMap((number, index) => [
        text(544 + index * 176, 384, 160, 44, copy(t, `fact${number}Value`), { font: FONTS.poppins, size: 32, bold: true, color: accent, shrink: true }),
        text(544 + index * 176, 430, 160, 18, copy(t, `fact${number}Label`), { font: FONTS.inter, size: 12, color: muted, shrink: true }),
      ]),
      ...deckFooter(t, "05", ink, muted),
    ]),
    pageOf(SLIDE, solid(ink), [
      text(64, 54, 520, 16, copy(t, "statsKicker"), { font: FONTS.poppins, size: 10, bold: true, color: accent, upper: true, spacing: 2, shrink: true }),
      text(64, 74, 640, 50, copy(t, "statsTitle"), { font: FONTS.poppins, size: 30, bold: true, color: "#ffffff", shrink: true }),
      ...stats.flatMap((number, index) => {
        const x = 64 + index * (card + 24);
        return [
          box("rect", x, 168, card, 264, solid("#1f2937"), { radius: 16 }),
          box("rect", x + 28, 196, 40, 5, solid(accent), { radius: 2.5 }),
          text(x + 28, 218, card - 56, 90, copy(t, `stat${number}Value`), { font: FONTS.poppins, size: 64, bold: true, color: index === 0 ? accent : "#ffffff", lineHeight: 1, valign: "middle", shrink: true }),
          text(x + 28, 318, card - 56, 22, copy(t, `stat${number}Label`), { font: FONTS.poppins, size: 15, bold: true, color: "#ffffff", shrink: true }),
          text(x + 28, 346, card - 56, 60, copy(t, `stat${number}Note`), { font: FONTS.inter, size: 11.5, color: "#9ca3af", lineHeight: 1.4, shrink: true }),
        ];
      }),
      ...deckFooter(t, "06", "#ffffff", "#9ca3af"),
    ]),
    pageOf(SLIDE, solid("#ffffff"), [
      box("ellipse", -160, 140, 520, 520, linear(135, accent, warm)),
      text(40, 300, 260, 100, copy(t, "deckClosing"), { font: FONTS.poppins, size: 26, bold: true, color: "#ffffff", lineHeight: 1.15, valign: "middle", shrink: true }),
      text(420, 140, 476, 80, t("studio.tpl.thankYou"), { font: FONTS.poppins, size: 56, bold: true, color: ink, valign: "bottom", shrink: true }),
      text(420, 230, 476, 44, copy(t, "questions"), { font: FONTS.inter, size: 16, color: muted, lineHeight: 1.35, shrink: true }),
      rule(420, 292, 476, "#f3c9bb", 1),
      ...contacts.flatMap((key, index) => {
        const y = 314 + index * 36;
        return [
          box("ellipse", 420, y + 6, 10, 10, solid(accent)),
          text(442, y, 454, 22, t(key), { font: FONTS.inter, size: 14, color: ink, shrink: true }),
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
  const numerals = ["I", "II", "III", "IV"];
  const captions = [1, 2, 3];
  const steps = [1, 2, 3, 4];
  const gallery = (SW - 128 - 48) / 3;
  const span = (SW - 128) / 4;
  const contacts = ["studio.tpl.email", "studio.tpl.website", "studio.tpl.phone"];
  return design(t("studio.templates.items.editorialDeck"), [gold, night, ivory], [
    pageOf(SLIDE, solid(night), [
      ...photoSlot(SW / 2, 0, SW / 2, SH, "#2a2520"),
      box("rect", SW / 2 + 24, 24, SW / 2 - 48, SH - 48, NONE, { stroke: stroke(gold, 0.8) }),
      text(64, 64, 360, 14, copy(t, "edKicker"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      text(64, 150, 380, 210, copy(t, "edTitle"), { font: FONTS.cormorant, size: 64, bold: true, color: ivory, lineHeight: 1, valign: "bottom", shrink: true }),
      rule(64, 382, 80, gold, 1),
      text(64, 398, 360, 44, copy(t, "edSubtitle"), { font: FONTS.josefin, size: 12, color: muted, lineHeight: 1.5, shrink: true }),
      text(64, SH - 64, 360, 14, t("studio.tpl.companyName"), { font: FONTS.josefin, size: 9, bold: true, color: gold, upper: true, spacing: 3, shrink: true }),
    ]),
    pageOf(SLIDE, solid(night), [
      text(64, 64, 300, 14, copy(t, "contents"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      text(64, 92, 360, 150, copy(t, "edContentsTitle"), { font: FONTS.cormorant, size: 46, color: ivory, lineHeight: 1.05, shrink: true }),
      rule(64, 270, 80, gold, 1),
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
    pageOf(SLIDE, solid("#1c1915"), [
      text(SW / 2 - 60, 46, 120, 140, "“", { font: FONTS.playfair, size: 140, color: gold, align: "center", lineHeight: 1 }),
      centredText(SLIDE_PAGE, 176, 180, copy(t, "edQuote"), { font: FONTS.cormorant, size: 38, italic: true, color: ivory, lineHeight: 1.2, valign: "middle", shrink: true, inset: 120 }),
      rule(SW / 2 - 30, 380, 60, gold, 1),
      centredText(SLIDE_PAGE, 396, 20, t("studio.tpl.personName"), { font: FONTS.josefin, size: 12, bold: true, color: ivory, upper: true, spacing: 3, shrink: true }),
      centredText(SLIDE_PAGE, 420, 16, t("studio.tpl.jobTitle"), { font: FONTS.josefin, size: 10, color: muted, upper: true, spacing: 2, shrink: true }),
    ]),
    pageOf(SLIDE, solid(night), [
      text(64, 46, 480, 50, copy(t, "edItem2"), { font: FONTS.cormorant, size: 38, color: ivory, shrink: true }),
      text(SW - 364, 64, 300, 16, copy(t, "edKicker"), { font: FONTS.josefin, size: 10, bold: true, color: gold, align: "right", upper: true, spacing: 3, shrink: true }),
      ...captions.flatMap((number, index) => {
        const x = 64 + index * (gallery + 24);
        const top = index === 1 ? 112 : 132;
        return [
          ...photoSlot(x, top, gallery, 452 - top, index === 1 ? "#332d27" : "#2a2520"),
          text(x, 466, 40, 20, `0${number}`, { font: FONTS.josefin, size: 10, bold: true, color: gold, spacing: 2, valign: "middle" }),
          text(x + 40, 462, gallery - 40, 28, copy(t, `edCaption${number}`), { font: FONTS.cormorant, size: 20, italic: true, color: ivory, valign: "middle", shrink: true }),
        ];
      }),
    ]),
    pageOf(SLIDE, solid(night), [
      text(64, 64, 400, 14, copy(t, "edItem4"), { font: FONTS.josefin, size: 10, bold: true, color: gold, upper: true, spacing: 4, shrink: true }),
      text(64, 88, 640, 56, copy(t, "edTimelineTitle"), { font: FONTS.cormorant, size: 42, color: ivory, shrink: true }),
      rule(64, 290, SW - 128, "#4a4038", 1),
      ...steps.flatMap((number, index) => {
        const x = 64 + index * span;
        return [
          text(x, 222, span - 20, 44, copy(t, `edStep${number}When`), { font: FONTS.cormorant, size: 30, italic: true, color: gold, valign: "bottom", shrink: true }),
          box("ellipse", x, 282, 16, 16, solid(index === steps.length - 1 ? gold : night), { stroke: stroke(gold, 1.5) }),
          text(x, 318, span - 28, 22, copy(t, `edStep${number}`), { font: FONTS.josefin, size: 12.5, bold: true, color: ivory, upper: true, spacing: 1, shrink: true }),
          text(x, 346, span - 28, 72, copy(t, `edStep${number}Note`), { font: FONTS.josefin, size: 11.5, color: muted, lineHeight: 1.45, shrink: true }),
        ];
      }),
    ]),
    pageOf(SLIDE, solid(night), [
      ...photoSlot(0, 0, 400, SH, "#2a2520"),
      text(464, 120, 432, 160, copy(t, "edClosing"), { font: FONTS.cormorant, size: 52, color: ivory, lineHeight: 1.05, valign: "bottom", shrink: true }),
      rule(464, 302, 80, gold, 1),
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
  const centre = (width - 54) / 2;
  return design(t("studio.templates.items.plannerCover"), [green, gold, cream], [
    pageOf(A5, linear(160, "#24473a", "#152b21"), [
      box("rect", 22, 22, width - 44, height - 44, NONE, { stroke: stroke(gold, 0.8), radius: 10 }),
      box("rect", width - 54, 0, 14, height, solid("#0f1f18")),
      text(centre - 150, 70, 300, 16, copy(t, "plannerLine"), { font: FONTS.josefin, size: 9.5, bold: true, color: gold, align: "center", upper: true, spacing: 3, shrink: true }),
      art("laurel", { primary: gold, secondary: "#9c7c3c" }, centre - 80, 136, 160, 153),
      text(centre - 80, 178, 160, 70, "2027", { font: FONTS.cinzel, size: 34, bold: true, color: cream, align: "center", valign: "middle" }),
      text(centre - 150, 316, 300, 64, copy(t, "planner"), { font: FONTS.greatVibes, size: 54, color: cream, align: "center", valign: "middle", shrink: true }),
      art("flourishDivider", { primary: gold, secondary: gold }, centre - 70, 388, 140, 18),
      box("rect", centre - 120, 440, 240, 92, solid(cream), { radius: 10 }),
      text(centre - 104, 454, 208, 14, copy(t, "belongsTo"), { font: FONTS.josefin, size: 8.5, bold: true, color: green, align: "center", upper: true, spacing: 1.5, shrink: true }),
      rule(centre - 96, 492, 192, "#9ca3af", 0.8),
      rule(centre - 96, 516, 192, "#9ca3af", 0.8),
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
  return design(t("studio.templates.items.portfolioCover"), [ink, lime], [
    pageOf(A4, solid("#f4f3ee"), [
      text(margin, 44, 250, 14, t("studio.tpl.website"), { font: FONTS.inter, size: 9, bold: true, color: ink, upper: true, spacing: 1, shrink: true }),
      text(W - margin - 250, 44, 250, 14, copy(t, "selectedWorks"), { font: FONTS.inter, size: 9, bold: true, color: ink, align: "right", upper: true, spacing: 1, shrink: true }),
      rule(margin, 68, inner, ink, 1),
      text(margin, 78, inner, 126, copy(t, "portfolio"), { font: FONTS.bebas, size: 128, color: ink, lineHeight: 0.95, spacing: 2, shrink: true }),
      ...photoSlot(margin, 210, 300, 380, "#dcdad2"),
      ...photoSlot(margin + 316, 210, side, 184, "#e6e4dc"),
      ...photoSlot(margin + 316, 406, side, 184, "#d2d0c6"),
      box("ellipse", margin + 258, 528, 112, 112, solid(lime)),
      text(margin + 268, 558, 92, 52, copy(t, "portfolioBadge"), { font: FONTS.bebas, size: 18, color: ink, align: "center", valign: "middle", lineHeight: 1, rotation: -12, shrink: true }),
      text(margin, 664, inner, 40, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 30, bold: true, color: ink, shrink: true }),
      text(margin, 706, 320, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 12, color: "#4b5563", shrink: true }),
      rule(margin, 748, inner, ink, 1),
      text(margin, 758, third, 14, t("studio.tpl.email"), { font: FONTS.inter, size: 9, color: ink, shrink: true }),
      text(margin + third, 758, third, 14, t("studio.tpl.phone"), { font: FONTS.inter, size: 9, color: ink, align: "center", shrink: true }),
      text(margin + third * 2, 758, third, 14, t("studio.tpl.website"), { font: FONTS.inter, size: 9, color: ink, align: "right", shrink: true }),
    ]),
  ]);
}

type Tile = { column: number; row: number; background: string; motif: "circle" | "quarter" | "corner" | "ring" | "diamond" | "half" | "triangle" | "dot" | "flipped"; color: string };

function tileShapes(tile: Tile, side: number): StudioElement[] {
  const x = tile.column * side;
  const y = tile.row * side;
  const fill = solid(tile.color);
  const base = box("rect", x, y, side, side, solid(tile.background));
  switch (tile.motif) {
    case "circle":
      return [base, box("ellipse", x + 14, y + 14, side - 28, side - 28, fill)];
    case "quarter":
      return [base, box("ellipse", x, y, side * 2, side * 2, fill)];
    case "corner":
      return [base, box("rightTriangle", x, y, side, side, fill)];
    case "flipped":
      return [base, box("rightTriangle", x, y, side, side, fill, { rotation: 180 })];
    case "ring":
      return [base, box("ellipse", x + 26, y + 26, side - 52, side - 52, NONE, { stroke: stroke(tile.color, 14) })];
    case "diamond":
      return [base, box("diamond", x + 20, y + 20, side - 40, side - 40, fill)];
    case "half":
      return [base, box("rect", x, y + side / 2, side, side / 2, fill)];
    case "triangle":
      return [base, box("triangle", x + 18, y + 22, side - 36, side - 40, fill)];
    case "dot":
      return [base, box("ellipse", x + side / 2 - 26, y + side / 2 - 26, 52, 52, fill)];
  }
}

function impactReport({ t }: TemplateContext) {
  const forest = "#14532d";
  const green = "#16a34a";
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
    { column: 1, row: 0, background: sand, motif: "quarter", color: orange },
    { column: 2, row: 0, background: mint, motif: "corner", color: green },
    { column: 3, row: 0, background: cream, motif: "ring", color: forest },
    { column: 0, row: 1, background: orange, motif: "diamond", color: cream },
    { column: 3, row: 1, background: green, motif: "quarter", color: sand },
    { column: 0, row: 2, background: cream, motif: "half", color: teal },
    { column: 1, row: 2, background: forest, motif: "triangle", color: sand },
    { column: 2, row: 2, background: sand, motif: "dot", color: orange },
    { column: 3, row: 2, background: teal, motif: "flipped", color: mint },
  ];
  return design(t("studio.templates.items.impactReport"), [forest, green, orange, sand], [
    pageOf(A4, solid("#ffffff"), [
      ...tiles.slice(0, 5).flatMap((tile) => tileShapes(tile, side)),
      ...photoSlot(side, side, side * 2, side, "#d9f99d"),
      ...tiles.slice(5).flatMap((tile) => tileShapes(tile, side)),
      text(margin, 486, inner - 210, 14, copy(t, "impactKicker"), { font: FONTS.montserrat, size: 10, bold: true, color: green, upper: true, spacing: 3, shrink: true }),
      text(margin, 508, inner - 210, 110, t("studio.tpl.reportTitle"), { font: FONTS.montserrat, size: 44, bold: true, color: forest, lineHeight: 1.05, shrink: true }),
      text(W - margin - 200, 486, 200, 110, "2027", { font: FONTS.bebas, size: 96, color: green, align: "right", lineHeight: 1, valign: "middle" }),
      box("rect", margin, 634, 60, 5, solid(orange), { radius: 2.5 }),
      text(margin, 654, inner - 40, 50, copy(t, "impactSubtitle"), { font: FONTS.inter, size: 15, color: "#374151", lineHeight: 1.4, shrink: true }),
      rule(margin, H - 80, inner, "#d1d5db", 0.8),
      text(margin, H - 66, 300, 18, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 12, bold: true, color: forest, shrink: true }),
      text(W - margin - 240, H - 66, 240, 18, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: "#6b7280", align: "right", valign: "middle", shrink: true }),
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
];
