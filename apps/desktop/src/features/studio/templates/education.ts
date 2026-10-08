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

function sideHeading(x: number, y: number, width: number, label: string, color: string, accent: string): StudioElement[] {
  return [text(x, y, width, 16, label, { font: FONTS.inter, size: 9, bold: true, color, upper: true, spacing: 1.6, valign: "middle", shrink: true }), box("rect", x, y + 20, 22, 2.5, solid(accent), { radius: 1.2 })];
}

function lessonFlow({ t }: TemplateContext) {
  const ink = "#1b2433";
  const coral = "#c2410c";
  const sage = "#3f6b5e";
  const paper = "#fbf7f0";
  const line = "#e2d9ca";
  const chips = ["studio.tpl.subject", "studio.tpl.grade", "studio.tpl.date", "studio.tpl.duration"];
  const chipGap = 12;
  const chipWidth = (INNER - chipGap * 3) / 4;
  const stages: [string, string][] = [
    ["00:00", "studio.tpl.lessonFlowHook"],
    ["00:05", "studio.tpl.lessonFlowTeach"],
    ["00:15", "studio.tpl.lessonFlowPractice"],
    ["00:30", "studio.tpl.lessonFlowApply"],
    ["00:40", "studio.tpl.lessonFlowReflect"],
  ];
  const railX = M + 62;
  const flowTop = 316;
  const step = 100;
  const sideX = M + 356;
  const sideWidth = W - M - sideX;
  const sideTop = 288;
  const sideBottom = H - 40;
  const badge = { x: W - M - 92, y: 38, side: 92 };
  return design(t("studio.templates.items.lessonFlow"), [ink, coral, sage, paper], [
    pageOf(A4, solid(paper), [
      art("topographic", { primary: "#e6dccb", secondary: "#f2d7c6" }, 0, 0, W, 260, { opacity: 0.55 }),
      art("blob", { primary: "#f6dccd", secondary: "#e4ece6" }, -90, H - 210, 260, 260, { opacity: 0.6, rotation: 40 }),
      text(M, 46, 330, 16, t("studio.tpl.schoolName"), { font: FONTS.inter, size: 9.5, bold: true, color: coral, upper: true, spacing: 2.4, valign: "middle", shrink: true }),
      text(M, 66, 340, 52, t("studio.tpl.lessonPlan"), { font: FONTS.baskerville, size: 38, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", M, 124, 56, 3, foil("copper", 0)),
      shadowed(box("ellipse", badge.x, badge.y, badge.side, badge.side, gradient(140, ["#e2622b", "#9a3412"])), "lifted", coral),
      box("ellipse", badge.x + 7, badge.y + 7, badge.side - 14, badge.side - 14, { type: "none" }, { stroke: stroke("#fde3d3", 0.8, "dashed") }),
      text(badge.x + 8, badge.y + 20, badge.side - 16, 14, t("studio.tpl.lessonFlowLesson"), { font: FONTS.inter, size: 8, bold: true, color: "#ffffff", align: "center", upper: true, spacing: 1.4, valign: "middle", shrink: true }),
      text(badge.x, badge.y + 36, badge.side, 40, "07", { font: FONTS.baskerville, size: 30, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
      ...chips.flatMap((key, index) => {
        const x = M + index * (chipWidth + chipGap);
        return [
          shadowed(box("rect", x, 146, chipWidth, 48, solid("#ffffff"), { radius: 10, stroke: stroke(line, 0.8) }), "soft"),
          text(x + 12, 154, chipWidth - 24, 14, t(key), { font: FONTS.inter, size: 8, bold: true, color: sage, upper: true, spacing: 1.2, valign: "middle", shrink: true }),
          rule(x + 12, 184, chipWidth - 24, line, 0.8),
        ];
      }),
      box("rect", M, 212, INNER, 60, solid("#fbe5d8"), { radius: 12 }),
      box("rect", M, 212, 5, 60, foil("copper", 90), { radius: 2.5 }),
      text(M + 22, 222, INNER - 44, 14, t("studio.tpl.lessonFlowBigIdea"), { font: FONTS.inter, size: 8.5, bold: true, color: "#9a3412", upper: true, spacing: 1.6, valign: "middle", shrink: true }),
      text(M + 22, 240, INNER - 44, 22, t("studio.tpl.lessonFlowBigIdeaPrompt"), { font: FONTS.baskerville, size: 12.5, italic: true, color: ink, valign: "middle", shrink: true }),
      ...sideHeading(M, sideTop, 260, t("studio.tpl.lessonFlowSequence"), ink, coral),
      vrule(railX, flowTop + 8, step * (stages.length - 1), "#d8c8b4", 1.2),
      ...stages.flatMap(([time, key], index) => {
        const y = flowTop + index * step;
        const filled = index % 2 === 0;
        const textX = railX + 20;
        const textWidth = sideX - 24 - textX;
        return [
          text(M, y, 48, 18, time, { font: FONTS.inter, size: 9.5, bold: true, color: "#5b4a3a", align: "right", valign: "middle" }),
          box("ellipse", railX - 8, y + 1, 16, 16, filled ? gradient(140, ["#e2622b", "#9a3412"]) : solid(paper), { stroke: stroke(coral, 1.6) }),
          text(textX, y, textWidth, 18, t(key), { font: FONTS.baskerville, size: 14.5, bold: true, color: ink, valign: "middle", shrink: true }),
          ...[34, 56, 78].map((offset) => rule(textX, y + offset, textWidth, line, 0.8, "dashed")),
        ];
      }),
      shadowed(box("rect", sideX, sideTop, sideWidth, sideBottom - sideTop, solid("#ffffff"), { radius: 14 }), "soft"),
      box("rect", sideX, sideTop, sideWidth, 5, gradient(90, [sage, "#7fa596"]), { radius: 2.5 }),
      ...sideHeading(sideX + 16, sideTop + 22, sideWidth - 32, t("studio.tpl.materials"), sage, coral),
      ...Array.from({ length: 5 }, (_, index) => {
        const y = sideTop + 62 + index * 26;
        return [box("rect", sideX + 16, y, 11, 11, { type: "none" }, { radius: 3, stroke: stroke(sage, 1) }), rule(sideX + 34, y + 11, sideWidth - 50, line, 0.8)];
      }).flat(),
      ...sideHeading(sideX + 16, sideTop + 206, sideWidth - 32, t("studio.tpl.lessonFlowSupport"), sage, coral),
      ...Array.from({ length: 5 }, (_, index) => rule(sideX + 16, sideTop + 256 + index * 24, sideWidth - 32, line, 0.8)),
      ...sideHeading(sideX + 16, sideTop + 384, sideWidth - 32, t("studio.tpl.homework"), sage, coral),
      ...Array.from({ length: 4 }, (_, index) => rule(sideX + 16, sideTop + 434 + index * 24, sideWidth - 32, line, 0.8)),
    ]),
  ]);
}

function sectionHead(x: number, y: number, width: number, number: string, label: string, badge: string, ink: string): StudioElement[] {
  return [
    shadowed(box("ellipse", x, y, 28, 28, solid(badge)), "soft"),
    text(x, y, 28, 28, number, { font: FONTS.poppins, size: 13, bold: true, color: ink, align: "center", valign: "middle" }),
    text(x + 40, y, width - 40, 28, label, { font: FONTS.poppins, size: 13, bold: true, color: ink, valign: "middle", shrink: true }),
  ];
}

function activitySheet({ t }: TemplateContext) {
  const cobalt = "#1d4ed8";
  const deep = "#0d1b3e";
  const sun = "#f5b700";
  const soft = "#e6ecfb";
  const line = "#c3cde8";
  const chip = 206;
  const rows = ["1", "2", "3", "4", "5"];
  const letters = ["A", "B", "C", "D", "E"];
  const bankX = M + 96;
  const bankGap = 10;
  const bankWidth = (W - M - bankX - bankGap * 4) / 5;
  return design(t("studio.templates.items.activitySheet"), [cobalt, deep, sun, "#fbfaf6"], [
    pageOf(A4, gradient(180, ["#fbfaf6", "#eef2fc"]), [
      art("blob", { primary: "#dbe4fb", secondary: "#fdf0c4" }, W - 210, H - 200, 280, 260, { opacity: 0.75, rotation: 30 }),
      shadowed(box("rect", M, 32, INNER, 116, gradient(125, [cobalt, deep]), { radius: 22 }), "lifted", cobalt),
      art("halftone", { primary: "#ffffff", secondary: sun }, M, 32, INNER, 116, { opacity: 0.22 }),
      box("ellipse", W - M - 132, 52, 76, 76, gradient(140, ["#ffd65a", sun])),
      box("ellipse", W - M - 142, 42, 96, 96, { type: "none" }, { stroke: stroke("#ffe08a", 1, "dashed") }),
      box("star", W - M - 112, 72, 36, 36, solid("#ffffff"), { points: 5, inner: 0.45 }),
      art("confetti", { primary: "#ffe08a", secondary: "#93c5fd" }, M + 250, 36, 150, 100, { opacity: 0.5 }),
      text(M + 28, 54, INNER - 200, 48, t("studio.tpl.activitySheetTitle"), { font: FONTS.poppins, size: 30, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(M + 28, 104, INNER - 200, 20, t("studio.tpl.activitySheetLead"), { font: FONTS.nunito, size: 12.5, color: "#dbe5ff", valign: "middle", shrink: true }),
      shadowed(box("rect", M, 166, INNER, 50, solid("#ffffff"), { radius: 14 }), "soft"),
      ...field(M + 18, 174, 196, t("studio.tpl.studentName"), cobalt, FONTS.nunito),
      ...field(M + 232, 174, 104, t("studio.tpl.date"), cobalt, FONTS.nunito),
      vrule(M + 354, 174, 34, line, 0.8),
      text(M + 370, 174, INNER - 388, 14, t("studio.tpl.activitySheetSelfCheck"), { font: FONTS.nunito, size: 8, bold: true, color: cobalt, upper: true, spacing: 1.2, shrink: true }),
      ...[0, 1, 2].map((index) => box("star", M + 370 + index * 28, 191, 20, 20, solid("#fff7da"), { points: 5, inner: 0.45, stroke: stroke("#d99a00", 1.2) })),
      ...sectionHead(M, 238, INNER, "1", t("studio.tpl.activitySheetMatch"), sun, deep),
      ...rows.flatMap((number, index) => {
        const y = 280 + index * 34;
        const right = W - M - chip;
        return [
          box("rect", M, y, chip, 26, solid(soft), { radius: 13 }),
          box("ellipse", M + 4, y + 3, 20, 20, solid(cobalt)),
          text(M + 4, y + 3, 20, 20, number, { font: FONTS.nunito, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          rule(M + 32, y + 18, chip - 46, "#9fb0e0", 0.8),
          box("ellipse", M + chip + 10, y + 9, 8, 8, solid(cobalt)),
          box("rect", right, y, chip, 26, solid("#fff6d6"), { radius: 13 }),
          box("ellipse", right + 4, y + 3, 20, 20, solid(sun)),
          text(right + 4, y + 3, 20, 20, letters[index], { font: FONTS.nunito, size: 10, bold: true, color: deep, align: "center", valign: "middle" }),
          rule(right + 32, y + 18, chip - 46, "#e8cf7a", 0.8),
          box("ellipse", right - 18, y + 9, 8, 8, solid(sun)),
        ];
      }),
      ...sectionHead(M, 468, INNER, "2", t("studio.tpl.activitySheetFill"), sun, deep),
      text(M, 508, 88, 26, t("studio.tpl.activitySheetBank"), { font: FONTS.nunito, size: 8.5, bold: true, color: cobalt, upper: true, spacing: 1.2, valign: "middle", shrink: true }),
      ...Array.from({ length: 5 }, (_, index) => box("rect", bankX + index * (bankWidth + bankGap), 508, bankWidth, 26, solid("#ffffff"), { radius: 13, stroke: stroke(cobalt, 1, "dashed") })),
      ...Array.from({ length: 4 }, (_, index) => {
        const y = 548 + index * 30;
        return [text(M, y, 20, 20, `${index + 1}.`, { font: FONTS.nunito, size: 11, bold: true, color: deep, valign: "middle" }), rule(M + 24, y + 18, INNER - 24, line, 0.9)];
      }).flat(),
      ...sectionHead(M, 680, INNER, "3", t("studio.tpl.activitySheetDraw"), sun, deep),
      shadowed(box("rect", M, 720, 220, 92, solid("#ffffff"), { radius: 16, stroke: stroke(cobalt, 1.2, "dashed") }), "soft"),
      ...[750, 776, 802].map((y) => rule(M + 244, y, INNER - 244, line, 0.9)),
    ]),
  ]);
}

type Subject = { key: string; fill: string; accent: string };

function colourTimetable({ t }: TemplateContext) {
  const ink = "#1e293b";
  const plum = "#3b2a7a";
  const muted = "#475569";
  const subject = (key: string, fill: string, accent: string): Subject => ({ key: `studio.tpl.colourTimetable${key}`, fill, accent });
  const maths = subject("Maths", "#dbeafe", "#2563eb");
  const english = subject("English", "#fce7f3", "#db2777");
  const science = subject("Science", "#dcfce7", "#16a34a");
  const history = subject("History", "#fef3c7", "#d97706");
  const geography = subject("Geography", "#ccfbf1", "#0d9488");
  const artClass = subject("Art", "#ffe4e6", "#e11d48");
  const music = subject("Music", "#ede9fe", "#7c3aed");
  const sport = subject("Sport", "#ffedd5", "#ea580c");
  const periods: (Subject[] | "break" | "lunch")[] = [
    [maths, english, science, maths, english],
    [english, maths, maths, history, science],
    "break",
    [science, geography, english, english, maths],
    [history, music, sport, geography, music],
    "lunch",
    [artClass, science, history, artClass, sport],
    [sport, english, music, science, artClass],
  ];
  const times = ["08:30", "09:20", "10:10", "10:30", "11:20", "12:10", "13:00", "13:50"];
  const days = ["studio.tpl.mondayShort", "studio.tpl.tuesdayShort", "studio.tpl.wednesdayShort", "studio.tpl.thursdayShort", "studio.tpl.fridayShort"].map((key) => t(key));
  const timeWidth = 50;
  const gap = 6;
  const dayWidth = (INNER - timeWidth - gap * 5) / 5;
  const dayX = (index: number) => M + timeWidth + gap + index * (dayWidth + gap);
  const lesson = 68;
  const band = 28;
  const headerY = 164;
  let cursor = headerY + 32 + gap;
  const rows = periods.map((period, index) => {
    const height = period === "break" ? band : period === "lunch" ? band + 6 : lesson;
    const top = cursor;
    cursor += height + gap;
    return { period, top, height, time: times[index] };
  });
  return design(t("studio.templates.items.colourTimetable"), [plum, "#2563eb", "#db2777", "#16a34a", "#f8f7fc"], [
    pageOf(A4, gradient(170, ["#f8f7fc", "#eef6f8"]), [
      art("blob", { primary: "#ede9fe", secondary: "#fce7f3" }, W - 230, -110, 330, 290, { opacity: 0.9 }),
      art("confetti", { primary: "#7c3aed", secondary: "#f59e0b" }, W - 300, 20, 260, 120, { opacity: 0.35 }),
      art("blob", { primary: "#dcfce7", secondary: "#dbeafe" }, -120, H - 150, 260, 220, { opacity: 0.8, rotation: 120 }),
      text(M, 44, 330, 16, t("studio.tpl.schoolName"), { font: FONTS.nunito, size: 9.5, bold: true, color: "#6d28d9", upper: true, spacing: 2.2, valign: "middle", shrink: true }),
      text(M, 64, 360, 50, t("studio.tpl.colourTimetableTitle"), { font: FONTS.josefin, size: 34, bold: true, color: plum, valign: "middle", shrink: true }),
      ...["#2563eb", "#db2777", "#16a34a", "#d97706", "#7c3aed"].map((colour, index) => box("rect", M + index * 22, 124, 18, 4, solid(colour), { radius: 2 })),
      shadowed(box("rect", W - M - 150, 72, 150, 34, gradient(90, ["#5b3fb0", plum]), { radius: 17 }), "soft", plum),
      text(W - M - 142, 72, 134, 34, t("studio.tpl.className"), { font: FONTS.nunito, size: 12, bold: true, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      ...days.flatMap((label, index) => [
        box("rect", dayX(index), headerY, dayWidth, 32, gradient(90, ["#4c3a96", plum]), { radius: 10 }),
        text(dayX(index), headerY, dayWidth, 32, label, { font: FONTS.josefin, size: 12, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      ]),
      ...rows.flatMap(({ period, top, height, time }) => {
        const clock = text(M, top, timeWidth, height, time, { font: FONTS.nunito, size: 10, bold: true, color: muted, align: "center", valign: "middle" });
        if (period === "break" || period === "lunch") {
          const lunch = period === "lunch";
          return [
            clock,
            box("rect", dayX(0), top, INNER - timeWidth - gap, height, solid(lunch ? "#fff4d6" : "#eef1f6"), { radius: 10, stroke: stroke(lunch ? "#f2d27a" : "#d5dbe5", 0.8, "dashed") }),
            text(dayX(0), top, INNER - timeWidth - gap, height, t(lunch ? "studio.tpl.colourTimetableLunch" : "studio.tpl.colourTimetableBreak"), { font: FONTS.nunito, size: 9.5, bold: true, color: lunch ? "#7c4a03" : muted, align: "center", valign: "middle", upper: true, spacing: 3, shrink: true }),
          ];
        }
        return [
          clock,
          ...period.flatMap((item, index) => {
            const x = dayX(index);
            return [
              shadowed(box("rect", x, top, dayWidth, height, solid(item.fill), { radius: 10 }), "soft"),
              box("rect", x, top, 4, height, solid(item.accent), { radius: 2 }),
              box("ellipse", x + dayWidth - 26, top + height - 26, 16, 16, solid(item.accent), { opacity: 0.18 }),
              text(x + 12, top + 10, dayWidth - 18, 30, t(item.key), { font: FONTS.nunito, size: 10.5, bold: true, color: ink, lineHeight: 1.15, shrink: true }),
            ];
          }),
        ];
      }),
      shadowed(box("rect", M, cursor + 10, INNER, H - 36 - cursor - 10, solid("#ffffff"), { radius: 14 }), "soft"),
      box("rect", M, cursor + 10, 5, H - 36 - cursor - 10, gradient(180, ["#7c3aed", "#db2777"]), { radius: 2.5 }),
      text(M + 22, cursor + 20, 200, 16, t("studio.tpl.colourTimetableRemember"), { font: FONTS.josefin, size: 10.5, bold: true, color: plum, upper: true, spacing: 1.5, valign: "middle", shrink: true }),
      rule(M + 22, cursor + 56, INNER - 44, "#e2e0ee", 0.8),
    ]),
  ]);
}

function readingLog({ t }: TemplateContext) {
  const wine = "#6d1a2d";
  const mustard = "#c59d5f";
  const teal = "#2f5d62";
  const paper = "#fdf8f3";
  const ink = "#2b0f17";
  const line = "#eadccf";
  const spineColours = [wine, mustard, teal, "#d97757", "#e8d5b7", "#3d405b", "#81b29a", "#b5576d"];
  const spines: [number, number][] = [
    [20, 92],
    [14, 78],
    [24, 104],
    [16, 86],
    [22, 96],
    [12, 72],
    [26, 100],
    [18, 84],
    [15, 90],
    [21, 80],
  ];
  const shelfY = 168;
  const shelfX = 300;
  const shelfWidth = W - M - shelfX;
  let bookX = shelfX + 10;
  const books = spines.flatMap(([width, height], index) => {
    const x = bookX;
    bookX += width + 2;
    const colour = spineColours[index % spineColours.length];
    return [box("rect", x, shelfY - height, width, height, solid(colour), { radius: 2 }), box("rect", x + 2, shelfY - height + 12, width - 4, 3, solid("#ffffff"), { opacity: 0.35 }), box("rect", x + 2, shelfY - 22, width - 4, 2, solid("#ffffff"), { opacity: 0.3 })];
  });
  const columns = [30, 72, INNER - 30 - 72 - 64 - 112, 64, 112];
  const tableTop = 206;
  const rowHeight = 34;
  const entries = 13;
  const ratingX = M + columns.slice(0, 4).reduce((sum, value) => sum + value, 0);
  const trackerTop = tableTop + rowHeight * (entries + 1) + 30;
  const trackerStep = (INNER - 40) / 20;
  return design(t("studio.templates.items.readingLog"), [wine, mustard, teal, paper], [
    pageOf(A4, radial(paper, "#f6ebe1", { cy: 0.15, radius: 1.1 }), [
      art("diagonalHatch", { primary: "#ead9c8", secondary: "#f1e2d3" }, 0, 0, W, 190, { opacity: 0.45 }),
      text(M, 44, 240, 16, t("studio.tpl.readingLogKicker"), { font: FONTS.lora, size: 10, bold: true, italic: true, color: teal, spacing: 1, valign: "middle", shrink: true }),
      text(M, 64, 250, 84, t("studio.tpl.readingLogTitle"), { font: FONTS.abril, size: 34, color: wine, lineHeight: 1.05, valign: "middle", shrink: true }),
      text(M, 150, 60, 18, t("studio.tpl.nameShort"), { font: FONTS.lora, size: 9.5, bold: true, color: teal, upper: true, spacing: 1.4, valign: "middle", shrink: true }),
      rule(M + 64, 166, 180, "#cdb8a6", 0.8),
      ...books,
      shadowed(box("rect", bookX + 4, shelfY - 70, 20, 70, solid(teal), { radius: 2, rotation: 16 }), "soft"),
      art("botanicalSprig", { primary: teal, secondary: mustard }, W - M - 48, shelfY - 88, 40, 80, { rotation: 8, opacity: 0.9 }),
      shadowed(box("rect", shelfX, shelfY, shelfWidth, 7, gradient(90, ["#8a5a3b", "#6b4329"]), { radius: 2 }), "soft"),
      shadowed(box("rect", M - 8, tableTop - 8, INNER + 16, rowHeight * (entries + 1) + 16, solid("#ffffff"), { radius: 14 }), "soft"),
      ...grid(
        M,
        tableTop,
        columns,
        rowHeight,
        [["#", t("studio.tpl.date"), t("studio.tpl.readingLogBook"), t("studio.tpl.readingLogPages"), t("studio.tpl.readingLogRating")], ...Array.from({ length: entries }, (_, index) => [String(index + 1), "", "", "", ""])],
        { font: FONTS.lora, size: 10, color: ink, headerFill: wine, zebra: "#fbf3ec", lineColor: line, aligns: ["center", "left", "left", "center", "center"] },
      ),
      ...columns.slice(0, -1).map((_, index) => vrule(M + columns.slice(0, index + 1).reduce((sum, value) => sum + value, 0), tableTop + rowHeight, rowHeight * entries, line, 0.8)),
      ...Array.from({ length: entries }, (_, row) => Array.from({ length: 5 }, (__, star) => box("star", ratingX + 12 + star * 18, tableTop + rowHeight * (row + 1) + rowHeight / 2 - 6.5, 13, 13, { type: "none" }, { points: 5, inner: 0.45, stroke: stroke(mustard, 1) }))).flat(),
      shadowed(box("rect", M - 8, trackerTop, INNER + 16, H - 36 - trackerTop, solid("#f6e9e3"), { radius: 14 }), "soft"),
      text(M + 12, trackerTop + 14, INNER - 24, 18, t("studio.tpl.readingLogTracker"), { font: FONTS.lora, size: 11.5, italic: true, color: wine, valign: "middle", shrink: true }),
      ...Array.from({ length: 20 }, (_, index) => box("rect", M + 20 + index * trackerStep + (trackerStep - 15) / 2, trackerTop + 44, 15, index % 3 === 0 ? 46 : index % 3 === 1 ? 40 : 43, solid("#ffffff"), { radius: 2.5, stroke: stroke(spineColours[index % 4], 1.1) })),
      rule(M + 14, trackerTop + 92, INNER - 28, "#8a5a3b", 2),
    ]),
  ]);
}

function studentAward({ t }: TemplateContext) {
  const night = "#0b1530";
  const gold = "#e9c46a";
  const pale = "#f8e7b0";
  const sky = "#93c5fd";
  const seal = { width: 150, height: 188 };
  const sealX = W / 2 - seal.width / 2;
  return design(t("studio.templates.items.studentAward"), [night, gold, "#1f3a75", "#ffffff"], [
    pageOf(A4, radial("#22407f", night, { cy: 0.3, radius: 1.05 }), [
      art("sunburst", { primary: "#2f4f93", secondary: gold }, 0, 0, W, H, { opacity: 0.16 }),
      art("confetti", { primary: gold, secondary: sky }, 48, 48, W - 96, 250, { opacity: 0.6 }),
      box("rect", 24, 24, W - 48, H - 48, { type: "none" }, { stroke: stroke(gold, 1.4) }),
      box("rect", 32, 32, W - 64, H - 64, { type: "none" }, { stroke: stroke(gold, 0.6) }),
      art("cornerTriangles", { primary: gold, secondary: "#2f4f93" }, 24, 24, 90, 90, { opacity: 0.85 }),
      art("cornerTriangles", { primary: gold, secondary: "#2f4f93" }, W - 114, H - 114, 90, 90, { opacity: 0.85, rotation: 180 }),
      shadowed(art("ribbonSeal", { primary: "#d4a537", secondary: "#fff3c4" }, sealX, 70, seal.width, seal.height), "lifted", "#000000"),
      box("star", W / 2 - 30, 70 + seal.height * 0.4 - 30, 60, 60, solid("#fff7dc"), { points: 5, inner: 0.45 }),
      centredText(page, 282, 20, t("studio.tpl.schoolName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: sky, upper: true, spacing: 3, valign: "middle", shrink: true }),
      centredText(page, 306, 84, t("studio.tpl.studentAwardTitle"), { font: FONTS.bebas, size: 76, color: gold, spacing: 4, valign: "middle", shrink: true, inset: 60 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 110, 398, 220, 14),
      centredText(page, 426, 22, t("studio.tpl.awardedTo"), { font: FONTS.montserrat, size: 12.5, color: "#dbe4f5", valign: "middle", shrink: true }),
      centredText(page, 454, 80, t("studio.tpl.recipientName"), { font: FONTS.dancing, size: 54, bold: true, color: "#ffffff", valign: "middle", shrink: true, inset: 60 }),
      box("rect", W / 2 - 130, 540, 260, 2, foil("gold", 0)),
      centredText(page, 560, 62, t("studio.tpl.studentAwardBody"), { font: FONTS.montserrat, size: 13, color: "#d5def0", lineHeight: 1.5, valign: "middle", shrink: true, inset: 92 }),
      shadowed(box("rect", W / 2 - 110, 636, 220, 30, solid("#1b336b"), { radius: 15, stroke: stroke(gold, 1) }), "soft", "#000000"),
      text(W / 2 - 100, 636, 200, 30, t("studio.tpl.academicYear"), { font: FONTS.montserrat, size: 10, bold: true, color: pale, align: "center", valign: "middle", spacing: 1, shrink: true }),
      text(84, 704, 170, 22, "{date}", { font: FONTS.montserrat, size: 12, color: "#ffffff", align: "center", valign: "bottom", shrink: true }),
      rule(84, 730, 170, gold, 0.8),
      text(84, 738, 170, 16, t("studio.tpl.date"), { font: FONTS.montserrat, size: 9, bold: true, color: pale, align: "center", upper: true, spacing: 1.6, shrink: true }),
      rule(W - 254, 730, 170, gold, 0.8),
      text(W - 254, 738, 170, 16, t("studio.tpl.teacher"), { font: FONTS.montserrat, size: 9, bold: true, color: pale, align: "center", upper: true, spacing: 1.6, shrink: true }),
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
  { id: "lessonFlow", category: "education", size: A4, build: lessonFlow },
  { id: "activitySheet", category: "education", size: A4, build: activitySheet },
  { id: "colourTimetable", category: "education", size: A4, build: colourTimetable },
  { id: "readingLog", category: "education", size: A4, build: readingLog },
  { id: "studentAward", category: "education", size: A4, build: studentAward },
];
