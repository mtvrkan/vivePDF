import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, grid, linear, pageOf, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext } from "./kit";

const A4 = "a4" as const;
const LANDSCAPE = "a4Landscape" as const;
const page = sizeOf(A4);
const W = page.width;
const M = 44;
const INNER = W - M * 2;

function field(x: number, y: number, width: number, label: string, color: string): StudioElement[] {
  return [
    text(x, y, width, 14, label, { font: FONTS.nunito, size: 9, bold: true, color, upper: true, spacing: 1 }),
    rule(x, y + 34, width, "#cbd5e1", 0.8),
  ];
}

function lessonPlan({ t }: TemplateContext) {
  const accent = "#0369a1";
  const sections = ["studio.tpl.objectives", "studio.tpl.materials", "studio.tpl.warmUp", "studio.tpl.activities", "studio.tpl.assessment", "studio.tpl.homework"];
  return design(t("studio.templates.items.lessonPlan"), [accent, "#f59e0b"], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, 96, linear(90, accent, "#0ea5e9")),
      text(M, 26, INNER, 40, t("studio.tpl.lessonPlan"), { font: FONTS.nunito, size: 28, bold: true, color: "#ffffff", shrink: true, valign: "middle" }),
      text(M, 64, INNER, 18, t("studio.tpl.schoolName"), { font: FONTS.nunito, size: 11, color: "#e0f2fe", shrink: true }),
      ...field(M, 116, 150, t("studio.tpl.subject"), accent),
      ...field(M + 170, 116, 150, t("studio.tpl.grade"), accent),
      ...field(M + 340, 116, INNER - 340, t("studio.tpl.date"), accent),
      ...field(M, 166, INNER, t("studio.tpl.topic"), accent),
      ...sections.flatMap((key, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = M + column * (INNER / 2 + 6);
        const y = 228 + row * 196;
        const width = INNER / 2 - 6;
        return [
          box("rect", x, y, width, 184, solid("#f8fafc"), { radius: 10, stroke: { color: "#e2e8f0", width: 1, dash: "solid" } }),
          box("rect", x, y, 6, 184, solid(index % 2 ? "#f59e0b" : accent), { radius: 3 }),
          text(x + 18, y + 12, width - 30, 20, t(key), { font: FONTS.nunito, size: 13, bold: true, color: "#0f172a", shrink: true }),
        ];
      }),
    ]),
  ]);
}

function worksheet({ t }: TemplateContext) {
  const accent = "#7c3aed";
  const sun = "#f59e0b";
  const questions = [1, 2, 3, 4, 5, 6];
  return design(t("studio.templates.items.worksheet"), [accent, sun], [
    pageOf(A4, solid("#fffdf8"), [
      art("blob", { primary: "#ede9fe", secondary: "#fef3c7" }, W - 220, -70, 290, 260, { opacity: 0.9 }),
      art("starSeal", { primary: sun, secondary: "#ffffff" }, W - 130, 40, 76, 76),
      text(M, 48, INNER - 120, 44, t("studio.tpl.worksheet"), { font: FONTS.caveat, size: 40, bold: true, color: accent, shrink: true }),
      text(M, 94, INNER - 120, 20, t("studio.tpl.worksheetTopic"), { font: FONTS.nunito, size: 13, color: "#4b5563", shrink: true }),
      ...field(M, 134, 280, t("studio.tpl.studentName"), accent),
      ...field(M + 300, 134, INNER - 300, t("studio.tpl.date"), accent),
      ...questions.flatMap((number, index) => {
        const y = 200 + index * 100;
        return [
          box("ellipse", M, y, 28, 28, solid(index % 2 ? sun : accent)),
          text(M, y, 28, 28, String(number), { font: FONTS.nunito, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(M + 40, y + 2, INNER - 40, 22, t("studio.tpl.question"), { font: FONTS.nunito, size: 13, bold: true, color: "#1f2937", shrink: true }),
          rule(M + 40, y + 52, INNER - 40, "#d1d5db", 0.8, "dashed"),
          rule(M + 40, y + 80, INNER - 40, "#d1d5db", 0.8, "dashed"),
        ];
      }),
    ]),
  ]);
}

function examCover({ t }: TemplateContext) {
  const navy = "#1e3a8a";
  const gold = "#b8892a";
  return design(t("studio.templates.items.examCover"), [navy, gold], [
    pageOf(A4, solid("#ffffff"), [
      frame("doubleFrame", { primary: navy, secondary: gold }, page),
      art("shield", { primary: navy, secondary: gold }, W / 2 - 36, 70, 72, 90),
      centredText(page, 172, 26, t("studio.tpl.schoolName"), { font: FONTS.baskerville, size: 17, bold: true, color: navy, shrink: true }),
      centredText(page, 200, 20, t("studio.tpl.academicYear"), { font: FONTS.baskerville, size: 12, color: "#4b5563", shrink: true }),
      centredText(page, 250, 60, t("studio.tpl.examTitle"), { font: FONTS.baskerville, size: 30, bold: true, color: "#111827", shrink: true, valign: "middle" }),
      art("diamondDivider", { primary: gold, secondary: navy }, W / 2 - 110, 318, 220, 14),
      ...grid(M + 20, 350, [(INNER - 40) / 2, (INNER - 40) / 2], 30, [
        [t("studio.tpl.subject"), ""],
        [t("studio.tpl.grade"), ""],
        [t("studio.tpl.studentName"), ""],
        [t("studio.tpl.studentNumber"), ""],
        [t("studio.tpl.duration"), t("studio.tpl.examDuration")],
      ], { font: FONTS.baskerville, size: 11, lineColor: "#cbd5e1" }),
      text(M + 20, 520, INNER - 40, 16, t("studio.tpl.instructions"), { font: FONTS.baskerville, size: 11, bold: true, color: navy, upper: true, spacing: 1.5 }),
      text(M + 20, 542, INNER - 40, 110, t("studio.tpl.examRules"), { font: FONTS.baskerville, size: 10.5, color: "#374151", lineHeight: 1.55, shrink: true }),
      ...grid(M + 20, 680, [0, 1, 2, 3].map(() => (INNER - 40) / 4), 34, [
        [t("studio.tpl.questionShort"), "1", "2", "3"],
        [t("studio.tpl.score"), "", "", ""],
      ], { font: FONTS.baskerville, size: 10, headerFill: navy, lineColor: "#cbd5e1", aligns: ["left", "center", "center", "center"] }),
    ]),
  ]);
}

function timetable({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const accent = "#0f766e";
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday"].map((key) => t(key));
  const times = ["08:30", "09:20", "10:10", "11:00", "11:50", "13:00", "13:50"];
  const width = land.width - 80;
  const columns = [80, ...days.map(() => (width - 80) / days.length)];
  return design(t("studio.templates.items.timetable"), [accent, "#f59e0b"], [
    pageOf(LANDSCAPE, solid("#f0fdfa"), [
      art("waves", { primary: accent, secondary: "#5eead4" }, 0, land.height - 70, land.width, 70, { opacity: 0.6 }),
      text(40, 30, 420, 40, t("studio.tpl.timetable"), { font: FONTS.nunito, size: 28, bold: true, color: accent, shrink: true }),
      text(land.width - 340, 38, 300, 26, t("studio.tpl.className"), { font: FONTS.nunito, size: 14, bold: true, color: "#134e4a", align: "right", shrink: true }),
      box("rect", 40, 86, width, 8 * 52, solid("#ffffff"), { radius: 8 }),
      ...grid(40, 86, columns, 52, [[t("studio.tpl.time"), ...days], ...times.map((time) => [time, "", "", "", "", ""])], { font: FONTS.nunito, size: 12, headerFill: accent, lineColor: "#99f6e4", aligns: ["center", "center", "center", "center", "center", "center"] }),
    ]),
  ]);
}

function attendance({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const accent = "#4338ca";
  const width = land.width - 80;
  const dayCount = 15;
  const columns = [30, 190, ...Array.from({ length: dayCount }, () => (width - 220) / dayCount)];
  const header = ["#", t("studio.tpl.studentName"), ...Array.from({ length: dayCount }, (_, index) => String(index + 1))];
  const rows = Array.from({ length: 15 }, (_, index) => [String(index + 1), "", ...Array.from({ length: dayCount }, () => "")]);
  return design(t("studio.templates.items.attendance"), [accent, "#a5b4fc"], [
    pageOf(LANDSCAPE, solid("#ffffff"), [
      text(40, 28, 420, 34, t("studio.tpl.attendanceSheet"), { font: FONTS.nunito, size: 24, bold: true, color: accent, shrink: true }),
      text(land.width - 380, 30, 340, 16, `${t("studio.tpl.className")} · ${t("studio.tpl.month")}`, { font: FONTS.nunito, size: 11, color: "#4b5563", align: "right", shrink: true }),
      text(land.width - 380, 48, 340, 16, t("studio.tpl.teacherName"), { font: FONTS.nunito, size: 11, color: "#4b5563", align: "right", shrink: true }),
      ...grid(40, 78, columns, 29, [header, ...rows], { font: FONTS.nunito, size: 9.5, headerFill: accent, zebra: "#eef2ff", lineColor: "#c7d2fe", aligns: ["center", "left", ...Array.from({ length: dayCount }, () => "center" as const)] }),
      text(40, land.height - 40, width, 16, t("studio.tpl.attendanceKey"), { font: FONTS.nunito, size: 9, color: "#6b7280", shrink: true }),
    ]),
  ]);
}

function rewardChart({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const pink = "#ec4899";
  const violet = "#8b5cf6";
  const sun = "#f59e0b";
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday", "studio.tpl.saturday", "studio.tpl.sunday"].map((key) => t(key));
  const goals = ["studio.tpl.goal1", "studio.tpl.goal2", "studio.tpl.goal3", "studio.tpl.goal4", "studio.tpl.goal5"];
  const width = land.width - 120;
  const columns = [190, ...days.map(() => (width - 190) / days.length)];
  return design(t("studio.templates.items.rewardChart"), [violet, pink, sun], [
    pageOf(LANDSCAPE, linear(135, "#fdf4ff", "#fef9c3"), [
      art("confetti", { primary: pink, secondary: violet }, 0, 0, land.width, 120, { opacity: 0.5 }),
      art("starSeal", { primary: sun, secondary: "#ffffff" }, 40, 24, 86, 86),
      text(140, 30, 500, 50, t("studio.tpl.rewardChart"), { font: FONTS.pacifico, size: 34, color: violet, shrink: true, valign: "middle" }),
      text(140, 82, 500, 22, t("studio.tpl.kidName"), { font: FONTS.caveat, size: 22, bold: true, color: pink, shrink: true }),
      box("rect", 60, 128, width, 6 * 62, solid("#ffffff"), { radius: 16 }),
      ...grid(60, 128, columns, 62, [[t("studio.tpl.goal"), ...days], ...goals.map((key) => [t(key), "", "", "", "", "", "", ""])], { font: FONTS.nunito, size: 12, headerFill: violet, lineColor: "#e9d5ff", aligns: ["left", "center", "center", "center", "center", "center", "center", "center"] }),
      text(60, land.height - 64, width, 28, t("studio.tpl.rewardLine"), { font: FONTS.caveat, size: 22, bold: true, color: "#6b21a8", shrink: true }),
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
