import type { StudioElement } from "@/types/studio";
import { darker } from "../ornaments/paint";
import { art, box, centredText, design, FONTS, foil, frame, gradient, grid, pageOf, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const LANDSCAPE = "a4Landscape" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;
const M = 44;
const INNER = W - M * 2;
const land = sizeOf(LANDSCAPE);
const LW = land.width;
const LH = land.height;

function field(x: number, y: number, width: number, label: string, color: string, font: string): StudioElement[] {
  return [
    text(x, y, width, 14, label, { font, size: 8, bold: true, color, upper: true, spacing: 1.2, shrink: true }),
    rule(x, y + 32, width, "#cbd5e1", 0.8),
  ];
}

function lessonPlan({ t }: TemplateContext) {
  const navy = "#0c4a6e";
  const sky = "#0369a1";
  const amber = "#b45309";
  const header = 132;
  const sections = ["studio.tpl.objectives", "studio.tpl.materials", "studio.tpl.warmUp", "studio.tpl.activities", "studio.tpl.assessment", "studio.tpl.homework"];
  const pad = 18;
  const card = { x: M, y: 106, width: INNER, height: 104 };
  const columnWidth = (INNER - pad * 2 - 32) / 3;
  const sectionTop = 230;
  const sectionHeight = 180;
  const sectionGap = 14;
  const sectionWidth = (INNER - sectionGap) / 2;
  return design(t("studio.templates.items.lessonPlan"), [navy, sky, amber, "#f6f8fb"], [
    pageOf(A4, solid("#f6f8fb"), [
      box("rect", 0, 0, W, header, gradient(135, [navy, sky])),
      art("topographic", { primary: "#ffffff", secondary: "#7dd3fc" }, 0, 0, W, header, { opacity: 0.2 }),
      art("arcRings", { primary: "#7dd3fc", secondary: "#fbbf24" }, W - 150, -40, 150, 150, { opacity: 0.45 }),
      text(M, 30, INNER - 140, 16, t("studio.tpl.schoolName"), { font: FONTS.inter, size: 9.5, bold: true, color: "#bae6fd", upper: true, spacing: 2, shrink: true }),
      text(M, 48, INNER - 140, 42, t("studio.tpl.lessonPlan"), { font: FONTS.montserrat, size: 30, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#ffffff"), { radius: 12 }), "soft"),
      ...field(card.x + pad, card.y + 16, columnWidth, t("studio.tpl.subject"), sky, FONTS.inter),
      ...field(card.x + pad + columnWidth + 16, card.y + 16, columnWidth, t("studio.tpl.grade"), sky, FONTS.inter),
      ...field(card.x + pad + (columnWidth + 16) * 2, card.y + 16, columnWidth, t("studio.tpl.date"), sky, FONTS.inter),
      ...field(card.x + pad, card.y + 58, INNER - pad * 2, t("studio.tpl.topic"), sky, FONTS.inter),
      ...sections.flatMap((key, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = M + column * (sectionWidth + sectionGap);
        const y = sectionTop + row * (sectionHeight + sectionGap);
        const accent = column ? amber : sky;
        return [
          shadowed(box("rect", x, y, sectionWidth, sectionHeight, solid("#ffffff"), { radius: 10, stroke: stroke("#e2e8f0", 0.8) }), "soft"),
          box("ellipse", x + 14, y + 14, 26, 26, solid(accent)),
          text(x + 14, y + 14, 26, 26, String(index + 1).padStart(2, "0"), { font: FONTS.montserrat, size: 9, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x + 50, y + 14, sectionWidth - 64, 26, t(key), { font: FONTS.montserrat, size: 12, bold: true, color: "#0f172a", valign: "middle", shrink: true }),
          rule(x + 14, y + 52, sectionWidth - 28, accent, 1.2),
          ...[1, 2, 3, 4].map((line) => rule(x + 14, y + 52 + line * 26, sectionWidth - 28, "#e2e8f0", 0.8, "dashed")),
        ];
      }),
    ]),
  ]);
}

function worksheet({ t }: TemplateContext) {
  const violet = "#6d28d9";
  const amber = "#b45309";
  const sun = "#f59e0b";
  const questions = [1, 2, 3, 4, 5, 6];
  const scoreX = W - M - 84;
  return design(t("studio.templates.items.worksheet"), [violet, amber, sun, "#fffdf8"], [
    pageOf(A4, gradient(180, ["#fffdf8", "#faf7ff"]), [
      art("blob", { primary: "#ede9fe", secondary: "#fef3c7" }, W - 250, -96, 330, 290, { opacity: 0.95 }),
      art("confetti", { primary: violet, secondary: sun }, W - 280, 14, 240, 120, { opacity: 0.35 }),
      art("blob", { primary: "#fef3c7", secondary: "#ede9fe" }, -110, H - 170, 240, 240, { opacity: 0.8, rotation: 120 }),
      text(M, 44, INNER - 120, 52, t("studio.tpl.worksheet"), { font: FONTS.caveat, size: 46, bold: true, color: violet, valign: "middle", shrink: true }),
      text(M, 98, INNER - 120, 20, t("studio.tpl.worksheetTopic"), { font: FONTS.nunito, size: 13, color: "#4b5563", shrink: true }),
      text(scoreX - 8, 40, 100, 14, t("studio.tpl.score"), { font: FONTS.nunito, size: 9, bold: true, color: violet, align: "center", upper: true, spacing: 1.5, shrink: true }),
      shadowed(box("ellipse", scoreX, 58, 84, 84, solid("#ffffff"), { stroke: stroke(violet, 1.5, "dashed") }), "soft"),
      shadowed(box("rect", M, 154, INNER, 58, solid("#ffffff"), { radius: 14 }), "soft"),
      ...field(M + 18, 164, 280, t("studio.tpl.studentName"), violet, FONTS.nunito),
      ...field(M + 318, 164, INNER - 336, t("studio.tpl.date"), violet, FONTS.nunito),
      ...questions.flatMap((number, index) => {
        const y = 236 + index * 94;
        const accent = index % 2 ? amber : violet;
        return [
          box("ellipse", M, y, 28, 28, solid(accent)),
          text(M, y, 28, 28, String(number), { font: FONTS.nunito, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(M + 42, y + 3, INNER - 42, 22, t("studio.tpl.question"), { font: FONTS.nunito, size: 13, bold: true, color: "#1f2937", shrink: true }),
          rule(M + 42, y + 50, INNER - 42, "#d4d0e4", 0.8, "dashed"),
          rule(M + 42, y + 76, INNER - 42, "#d4d0e4", 0.8, "dashed"),
        ];
      }),
      art("dotsDivider", { primary: violet, secondary: sun }, W / 2 - 60, H - 40, 120, 10),
    ]),
  ]);
}

function examCover({ t }: TemplateContext) {
  const palette = PALETTES.midnightGold;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  const left = 84;
  const width = W - left * 2;
  const labelWidth = 150;
  const scoreColumns = [110, ...Array.from({ length: 6 }, () => (width - 110) / 6)];
  return design(t("studio.templates.items.examCover"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.35, radius: 1 }), [
      frame("ornateFrame", colours, page),
      shadowed(art("shield", colours, W / 2 - 30, 84, 60, 76), "soft"),
      centredText(page, 172, 24, t("studio.tpl.schoolName"), { font: FONTS.cinzel, size: 16, bold: true, color: palette.accent, spacing: 1.5, valign: "middle", shrink: true, inset: 90 }),
      centredText(page, 198, 20, t("studio.tpl.academicYear"), { font: FONTS.garamond, size: 13, italic: true, color: palette.muted, shrink: true, inset: 90 }),
      centredText(page, 232, 56, t("studio.tpl.examTitle"), { font: FONTS.cinzel, size: 28, bold: true, color: palette.ink, spacing: 2, valign: "middle", shrink: true, inset: 80 }),
      art("diamondDivider", { primary: palette.accent2, secondary: palette.accent }, W / 2 - 110, 296, 220, 14),
      rule(left, 330, width, palette.accent2, 1),
      ...grid(left, 330, [labelWidth, width - labelWidth], 32, [
        [t("studio.tpl.subject"), ""],
        [t("studio.tpl.grade"), ""],
        [t("studio.tpl.studentName"), ""],
        [t("studio.tpl.studentNumber"), ""],
        [t("studio.tpl.duration"), t("studio.tpl.examDuration")],
      ], { font: FONTS.garamond, size: 12, color: palette.ink, zebra: "#f4ede0", lineColor: "#d9ccb2" }),
      vrule(left + labelWidth, 330, 160, "#d9ccb2", 0.8),
      shadowed(box("rect", left, 504, width, 120, solid("#ffffff"), { radius: 8 }), "soft"),
      box("rect", left, 504, 4, 120, foil("gold", 90)),
      text(left + 24, 520, width - 48, 18, t("studio.tpl.instructions"), { font: FONTS.cinzel, size: 11, bold: true, color: palette.accent, upper: true, spacing: 2, shrink: true }),
      text(left + 24, 546, width - 48, 66, t("studio.tpl.examRules"), { font: FONTS.garamond, size: 12, color: "#374151", lineHeight: 1.5, shrink: true }),
      ...grid(left, 648, scoreColumns, 34, [
        [t("studio.tpl.questionShort"), "1", "2", "3", "4", "5", t("studio.tpl.total")],
        [t("studio.tpl.score"), "", "", "", "", "", ""],
      ], { font: FONTS.garamond, size: 11, color: palette.ink, headerFill: palette.accent, lineColor: "#d9ccb2", aligns: ["left", "center", "center", "center", "center", "center", "center"] }),
      ...scoreColumns.slice(0, -1).map((_, index) => vrule(left + scoreColumns.slice(0, index + 1).reduce((sum, value) => sum + value, 0), 682, 34, "#d9ccb2", 0.8)),
      rule(W / 2 - 90, 752, 180, palette.accent2, 0.8),
      centredText(page, 758, 16, t("studio.tpl.teacher"), { font: FONTS.garamond, size: 10, color: palette.muted, upper: true, spacing: 1.5, shrink: true, inset: W / 2 - 90 }),
    ]),
  ]);
}

function timetable({ t }: TemplateContext) {
  const teal = "#0f766e";
  const deep = "#134e4a";
  const line = "#cde9e4";
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday"].map((key) => t(key));
  const times = ["08:30", "09:20", "10:10", "11:00", "11:50", "13:00", "13:50"];
  const left = 52;
  const top = 110;
  const width = LW - left * 2;
  const rowHeight = 54;
  const timeWidth = 86;
  const dayWidth = (width - timeWidth) / days.length;
  const columns = [timeWidth, ...days.map(() => dayWidth)];
  const bodyHeight = times.length * rowHeight;
  return design(t("studio.templates.items.timetable"), [teal, deep, "#f59e0b", "#f4faf9"], [
    pageOf(LANDSCAPE, gradient(180, ["#f4faf9", "#e3f2ee"]), [
      art("topographic", { primary: teal, secondary: "#f59e0b" }, 0, 0, LW, LH, { opacity: 0.12 }),
      art("waves", { primary: teal, secondary: "#5eead4" }, 0, LH - 44, LW, 44, { opacity: 0.35 }),
      text(40, 28, 460, 16, t("studio.tpl.schoolName"), { font: FONTS.inter, size: 9.5, bold: true, color: teal, upper: true, spacing: 2, shrink: true }),
      text(40, 44, 460, 40, t("studio.tpl.timetable"), { font: FONTS.poppins, size: 26, bold: true, color: deep, valign: "middle", shrink: true }),
      shadowed(box("rect", LW - 40 - 170, 44, 170, 36, solid(teal), { radius: 18 }), "soft"),
      text(LW - 40 - 160, 44, 150, 36, t("studio.tpl.className"), { font: FONTS.poppins, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      shadowed(box("rect", 40, 98, LW - 80, top - 98 + rowHeight + bodyHeight + 12, solid("#ffffff"), { radius: 14 }), "soft"),
      box("rect", left, top + rowHeight, timeWidth, bodyHeight, solid("#eaf6f3")),
      ...grid(left, top, columns, rowHeight, [[t("studio.tpl.time"), ...days], ...times.map((time) => [time, "", "", "", "", ""])], { font: FONTS.inter, size: 11.5, color: deep, headerFill: teal, lineColor: line, aligns: ["center", "center", "center", "center", "center", "center"] }),
      ...days.map((_, index) => vrule(left + timeWidth + dayWidth * index, top + rowHeight, bodyHeight, line, 0.8)),
    ]),
  ]);
}

function attendance({ t }: TemplateContext) {
  const indigo = "#4338ca";
  const deep = "#312e81";
  const line = "#c7d2fe";
  const left = 40;
  const top = 86;
  const width = LW - left * 2;
  const dayCount = 15;
  const rowHeight = 28;
  const dayWidth = (width - 220) / dayCount;
  const columns = [30, 190, ...Array.from({ length: dayCount }, () => dayWidth)];
  const header = ["#", t("studio.tpl.studentName"), ...Array.from({ length: dayCount }, (_, index) => String(index + 1))];
  const rows = Array.from({ length: 15 }, (_, index) => [String(index + 1), "", ...Array.from({ length: dayCount }, () => "")]);
  const gridHeight = (rows.length + 1) * rowHeight;
  return design(t("studio.templates.items.attendance"), [indigo, deep, "#a5b4fc", "#eef2ff"], [
    pageOf(LANDSCAPE, gradient(180, ["#fbfbff", "#f1f3fe"]), [
      box("rect", 0, 0, LW, 6, gradient(90, [indigo, "#7c3aed"])),
      art("halftone", { primary: indigo, secondary: "#a5b4fc" }, LW - 320, 6, 320, 70, { opacity: 0.35 }),
      text(left, 26, 420, 36, t("studio.tpl.attendanceSheet"), { font: FONTS.montserrat, size: 24, bold: true, color: deep, valign: "middle", shrink: true }),
      text(LW - 380, 28, 340, 16, `${t("studio.tpl.className")} · ${t("studio.tpl.month")}`, { font: FONTS.inter, size: 10.5, bold: true, color: deep, align: "right", shrink: true }),
      text(LW - 380, 46, 340, 16, t("studio.tpl.teacherName"), { font: FONTS.inter, size: 10.5, color: "#475569", align: "right", shrink: true }),
      shadowed(box("rect", left - 8, top - 8, width + 16, gridHeight + 16, solid("#ffffff"), { radius: 12 }), "soft"),
      ...grid(left, top, columns, rowHeight, [header, ...rows], { font: FONTS.inter, size: 9, color: "#1e1b4b", headerFill: indigo, zebra: "#f3f4ff", lineColor: line, aligns: ["center", "left", ...Array.from({ length: dayCount }, () => "center" as const)] }),
      ...columns.slice(0, -1).map((_, index) => vrule(left + columns.slice(0, index + 1).reduce((sum, value) => sum + value, 0), top + rowHeight, gridHeight - rowHeight, line, 0.6)),
      text(left, LH - 34, width, 16, t("studio.tpl.attendanceKey"), { font: FONTS.inter, size: 9, color: "#475569", shrink: true }),
    ]),
  ]);
}

function rewardChart({ t }: TemplateContext) {
  const violet = "#6d28d9";
  const pink = "#db2777";
  const sun = "#f59e0b";
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday", "studio.tpl.saturday", "studio.tpl.sunday"].map((key) => t(key));
  const goals = ["studio.tpl.goal1", "studio.tpl.goal2", "studio.tpl.goal3", "studio.tpl.goal4", "studio.tpl.goal5"];
  const left = 68;
  const top = 136;
  const width = LW - left * 2;
  const rowHeight = 60;
  const goalWidth = 180;
  const dayWidth = (width - goalWidth) / days.length;
  const columns = [goalWidth, ...days.map(() => dayWidth)];
  const stars = goals.flatMap((_, row) => days.map((__, column) => box("star", left + goalWidth + dayWidth * column + dayWidth / 2 - 12, top + rowHeight * (row + 1) + rowHeight / 2 - 12, 24, 24, { type: "none" }, { stroke: stroke("#e9d5ff", 1.4), points: 5, inner: 0.45 })));
  return design(t("studio.templates.items.rewardChart"), [violet, pink, sun, "#fdf4ff"], [
    pageOf(LANDSCAPE, gradient(135, ["#fdf4ff", "#fef9c3"]), [
      art("confetti", { primary: pink, secondary: violet }, 140, 0, LW - 180, 120, { opacity: 0.4 }),
      art("blob", { primary: "#fbcfe8", secondary: "#ede9fe" }, LW - 170, -70, 240, 220, { opacity: 0.7 }),
      art("blob", { primary: "#fde68a", secondary: "#fbcfe8" }, -80, LH - 150, 220, 220, { opacity: 0.7, rotation: 140 }),
      shadowed(art("starSeal", { primary: sun, secondary: "#ffffff" }, 50, 24, 86, 86), "soft"),
      text(150, 28, 520, 52, t("studio.tpl.rewardChart"), { font: FONTS.pacifico, size: 34, color: violet, valign: "middle", shrink: true }),
      text(152, 84, 520, 22, t("studio.tpl.kidName"), { font: FONTS.nunito, size: 15, bold: true, color: darker(pink, 0.15), spacing: 0.5, shrink: true }),
      shadowed(box("rect", left - 12, top - 12, width + 24, rowHeight * 6 + 24, solid("#ffffff"), { radius: 18 }), "lifted", violet),
      ...grid(left, top, columns, rowHeight, [[t("studio.tpl.goal"), ...days], ...goals.map((key) => [t(key), "", "", "", "", "", "", ""])], { font: FONTS.nunito, size: 12, color: "#2e1065", headerFill: violet, lineColor: "#ede9fe", aligns: ["left", "center", "center", "center", "center", "center", "center", "center"] }),
      ...stars,
      shadowed(box("rect", LW / 2 - 200, LH - 72, 400, 40, gradient(90, [sun, "#fbbf24"]), { radius: 20 }), "soft"),
      text(LW / 2 - 180, LH - 72, 360, 40, t("studio.tpl.rewardLine"), { font: FONTS.nunito, size: 15, bold: true, color: "#451a03", align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

export const EDUCATION_TEMPLATES: StudioTemplate[] = [
  { id: "lessonPlan", category: "education", size: A4, build: lessonPlan },
  { id: "worksheet", category: "education", size: A4, build: worksheet },
  { id: "examCover", category: "education", size: A4, build: examCover },
  { id: "timetable", category: "education", size: LANDSCAPE, build: timetable },
  { id: "attendance", category: "education", size: LANDSCAPE, build: attendance },
  { id: "rewardChart", category: "education", size: LANDSCAPE, build: rewardChart },
];
