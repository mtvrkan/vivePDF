import type { StudioElement } from "@/types/studio";
import { art, box, design, FONTS, grid, linear, pageOf, photoSlot, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext } from "./kit";

const A4 = "a4" as const;
const LANDSCAPE = "a4Landscape" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;

function heading(x: number, y: number, width: number, label: string, color: string, font: string): StudioElement[] {
  return [
    text(x, y, width, 18, label, { font, size: 11, bold: true, color, spacing: 2, upper: true }),
    rule(x, y + 24, width, color, 1),
  ];
}

function cv({ t }: TemplateContext) {
  const side = 200;
  const navy = "#1e293b";
  const accent = "#38bdf8";
  const skills = ["studio.tpl.skill1", "studio.tpl.skill2", "studio.tpl.skill3", "studio.tpl.skill4"];
  const levels = [0.9, 0.75, 0.8, 0.6];
  const body = W - side - 72;
  return design(t("studio.templates.items.cvDesign"), [navy, accent], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, side, H, solid(navy)),
      ...photoSlot(side / 2 - 60, 46, 120, 120, "#334155", "circle"),
      ...heading(24, 196, side - 48, t("studio.tpl.contact"), accent, FONTS.montserrat),
      ...["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website", "studio.tpl.address"].map((key, index) =>
        text(24, 232 + index * 34, side - 48, 30, t(key), { font: FONTS.inter, size: 9, color: "#e2e8f0", lineHeight: 1.3, shrink: true }),
      ),
      ...heading(24, 386, side - 48, t("studio.tpl.skills"), accent, FONTS.montserrat),
      ...skills.flatMap((key, index) => [
        text(24, 422 + index * 38, side - 48, 16, t(key), { font: FONTS.inter, size: 9.5, color: "#f1f5f9", shrink: true }),
        box("rect", 24, 442 + index * 38, side - 48, 5, solid("#334155"), { radius: 2.5 }),
        box("rect", 24, 442 + index * 38, (side - 48) * (levels[index] ?? 0.5), 5, solid(accent), { radius: 2.5 }),
      ]),
      ...heading(24, 596, side - 48, t("studio.tpl.languages"), accent, FONTS.montserrat),
      text(24, 630, side - 48, 60, t("studio.tpl.languageList"), { font: FONTS.inter, size: 9.5, color: "#e2e8f0", lineHeight: 1.5, shrink: true }),
      text(side + 36, 50, body, 48, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 32, bold: true, color: navy, shrink: true }),
      text(side + 36, 98, body, 20, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 13, color: "#0284c7", spacing: 2, upper: true, shrink: true }),
      text(side + 36, 132, body, 66, t("studio.tpl.profileSummary"), { font: FONTS.inter, size: 10, color: "#475569", lineHeight: 1.5, shrink: true }),
      ...heading(side + 36, 214, body, t("studio.tpl.experience"), navy, FONTS.montserrat),
      ...[0, 1, 2].flatMap((index) => {
        const y = 252 + index * 104;
        return [
          box("ellipse", side + 36, y + 4, 9, 9, solid(accent)),
          text(side + 54, y, body - 110, 18, t("studio.tpl.roleTitle"), { font: FONTS.montserrat, size: 11.5, bold: true, color: navy, shrink: true }),
          text(side + 36 + body - 100, y, 100, 18, t("studio.tpl.yearRange"), { font: FONTS.inter, size: 9, color: "#64748b", align: "right", shrink: true }),
          text(side + 54, y + 18, body - 18, 16, t("studio.tpl.companyName"), { font: FONTS.inter, size: 9.5, italic: true, color: "#0284c7", shrink: true }),
          text(side + 54, y + 38, body - 18, 56, t("studio.tpl.roleDescription"), { font: FONTS.inter, size: 9.5, color: "#475569", lineHeight: 1.45, shrink: true }),
        ];
      }),
      ...heading(side + 36, 574, body, t("studio.tpl.education"), navy, FONTS.montserrat),
      ...[0, 1].flatMap((index) => {
        const y = 612 + index * 62;
        return [
          text(side + 36, y, body - 110, 18, t("studio.tpl.degree"), { font: FONTS.montserrat, size: 11, bold: true, color: navy, shrink: true }),
          text(side + 36 + body - 100, y, 100, 18, t("studio.tpl.yearRange"), { font: FONTS.inter, size: 9, color: "#64748b", align: "right", shrink: true }),
          text(side + 36, y + 18, body, 16, t("studio.tpl.schoolName"), { font: FONTS.inter, size: 9.5, color: "#475569", shrink: true }),
        ];
      }),
    ]),
  ]);
}

function weeklyPlanner({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const accent = "#9d4edd";
  const tint = "#f3e8ff";
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday", "studio.tpl.saturday", "studio.tpl.sunday"];
  const gap = 10;
  const columnWidth = (land.width - 60 - gap * 3) / 4;
  const cellHeight = (land.height - 120 - gap) / 2;
  return design(t("studio.templates.items.weeklyPlanner"), [accent, "#ff9f1c"], [
    pageOf(LANDSCAPE, solid("#fdfbff"), [
      text(30, 26, 400, 40, t("studio.tpl.weeklyPlanner"), { font: FONTS.dancing, size: 34, bold: true, color: accent, shrink: true, valign: "middle" }),
      text(land.width - 330, 36, 300, 22, t("studio.tpl.weekOf"), { font: FONTS.raleway, size: 12, color: "#6b7280", align: "right", shrink: true }),
      ...[...days, "studio.tpl.notes"].flatMap((key, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = 30 + column * (columnWidth + gap);
        const y = 84 + row * (cellHeight + gap);
        const notes = key === "studio.tpl.notes";
        return [
          box("rect", x, y, columnWidth, cellHeight, solid(notes ? "#fff7ed" : "#ffffff"), { radius: 10, stroke: { color: notes ? "#fed7aa" : "#e9d5ff", width: 1, dash: "solid" } }),
          box("rect", x, y, columnWidth, 28, solid(notes ? "#ffedd5" : tint), { radius: 10 }),
          text(x + 12, y, columnWidth - 24, 28, t(key), { font: FONTS.raleway, size: 11, bold: true, color: notes ? "#c2410c" : accent, upper: true, spacing: 1.5, valign: "middle", shrink: true }),
          ...[1, 2, 3, 4, 5, 6, 7].map((line) => rule(x + 12, y + 28 + line * 24, columnWidth - 24, "#ede9fe", 0.6)),
        ];
      }),
    ]),
  ]);
}

function monthlyCalendar({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const accent = "#e76f51";
  const ink = "#264653";
  const days = ["studio.tpl.mondayShort", "studio.tpl.tuesdayShort", "studio.tpl.wednesdayShort", "studio.tpl.thursdayShort", "studio.tpl.fridayShort", "studio.tpl.saturdayShort", "studio.tpl.sundayShort"].map((key) => t(key));
  const width = land.width - 60;
  const columns = days.map(() => width / 7);
  const weeks = Array.from({ length: 6 }, (_, week) => days.map((_, day) => {
    const date = week * 7 + day - 2;
    return date >= 1 && date <= 31 ? String(date) : "";
  }));
  return design(t("studio.templates.items.monthlyCalendar"), [accent, ink], [
    pageOf(LANDSCAPE, solid("#fffcf7"), [
      box("rect", 0, 0, land.width, 84, linear(90, ink, "#2a9d8f")),
      text(30, 18, 420, 50, t("studio.tpl.monthName"), { font: FONTS.playfair, size: 36, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(land.width - 230, 28, 200, 30, "2027", { font: FONTS.playfair, size: 28, color: "#e9c46a", align: "right", valign: "middle" }),
      ...grid(30, 100, columns, 26, [days], { font: FONTS.raleway, size: 10, headerFill: accent, aligns: days.map(() => "center" as const) }),
      ...weeks.flatMap((week, row) =>
        week.flatMap((label, column) => {
          const x = 30 + column * (width / 7);
          const y = 126 + row * 72;
          return [
            box("rect", x, y, width / 7, 72, solid(column >= 5 ? "#fdf0e6" : "#ffffff"), { stroke: { color: "#e5e7eb", width: 0.6, dash: "solid" } }),
            ...(label ? [text(x + 6, y + 4, 30, 18, label, { font: FONTS.raleway, size: 11, bold: true, color: column >= 5 ? accent : ink })] : []),
          ];
        }),
      ),
    ]),
  ]);
}

function recipeCard({ t }: TemplateContext) {
  const card = { width: 432, height: 648 };
  const olive = "#606c38";
  const terracotta = "#bc6c25";
  return design(t("studio.templates.items.recipeCard"), [olive, terracotta], [
    pageOf(card, solid("#fefae0"), [
      ...photoSlot(24, 24, card.width - 48, 200, "#e9edc9", "rounded"),
      text(24, 240, card.width - 48, 44, t("studio.tpl.recipeTitle"), { font: FONTS.playfair, size: 28, bold: true, color: "#283618", shrink: true }),
      ...[["studio.tpl.prepTime", "studio.tpl.prepTimeValue"], ["studio.tpl.cookTime", "studio.tpl.cookTimeValue"], ["studio.tpl.servings", "studio.tpl.servingsValue"]].flatMap(([label, value], index) => {
        const x = 24 + index * 132;
        return [
          box("rect", x, 292, 120, 44, solid("#ffffff"), { radius: 10 }),
          text(x, 296, 120, 14, t(label ?? ""), { font: FONTS.nunito, size: 8, bold: true, color: terracotta, align: "center", upper: true, spacing: 1, shrink: true }),
          text(x, 312, 120, 20, t(value ?? ""), { font: FONTS.nunito, size: 12, bold: true, color: "#283618", align: "center", shrink: true }),
        ];
      }),
      ...heading(24, 354, 150, t("studio.tpl.ingredients"), olive, FONTS.nunito),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((index) => [
        box("ellipse", 24, 392 + index * 30, 6, 6, solid(terracotta)),
        text(36, 384 + index * 30, 140, 22, t("studio.tpl.ingredient"), { font: FONTS.nunito, size: 10, color: "#3f3f1f", valign: "middle", shrink: true }),
      ]),
      ...heading(196, 354, card.width - 220, t("studio.tpl.method"), olive, FONTS.nunito),
      ...[0, 1, 2, 3].flatMap((index) => [
        text(196, 390 + index * 54, 18, 18, String(index + 1), { font: FONTS.playfair, size: 14, bold: true, color: terracotta }),
        text(218, 390 + index * 54, card.width - 242, 48, t("studio.tpl.methodStep"), { font: FONTS.nunito, size: 10, color: "#3f3f1f", lineHeight: 1.4, shrink: true }),
      ]),
    ]),
  ]);
}

function todoList({ t }: TemplateContext) {
  const mint = "#2a9d8f";
  const coral = "#f4a261";
  return design(t("studio.templates.items.todoList"), [mint, coral], [
    pageOf(A4, solid("#ffffff"), [
      art("blob", { primary: "#d8f3dc", secondary: "#b7e4c7" }, -90, -90, 300, 280, { opacity: 0.9 }),
      art("blob", { primary: "#ffe8d6", secondary: "#fcd5ce" }, W - 210, H - 220, 300, 300, { opacity: 0.9, rotation: 140 }),
      text(60, 70, W - 120, 56, t("studio.tpl.todoTitle"), { font: FONTS.caveat, size: 52, bold: true, color: mint, shrink: true, valign: "middle" }),
      text(60, 130, 200, 20, t("studio.tpl.date"), { font: FONTS.nunito, size: 11, color: "#6b7280" }),
      rule(110, 146, 140, "#cbd5e1", 0.8),
      ...Array.from({ length: 16 }, (_, index) => {
        const y = 186 + index * 38;
        return [
          box("rect", 60, y, 18, 18, { type: "none" }, { radius: 4, stroke: { color: index < 3 ? coral : mint, width: 1.5, dash: "solid" } }),
          rule(92, y + 18, W - 152, "#e5e7eb", 0.8),
        ];
      }).flat(),
    ]),
  ]);
}

export const PERSONAL_TEMPLATES: StudioTemplate[] = [
  { id: "cvDesign", category: "personal", size: A4, build: cv },
  { id: "weeklyPlanner", category: "personal", size: LANDSCAPE, build: weeklyPlanner },
  { id: "monthlyCalendar", category: "personal", size: LANDSCAPE, build: monthlyCalendar },
  { id: "recipeCard", category: "personal", size: { width: 432, height: 648 }, build: recipeCard },
  { id: "todoList", category: "personal", size: A4, build: todoList },
];
