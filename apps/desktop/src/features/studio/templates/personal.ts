import type { StudioElement } from "@/types/studio";
import { art, box, design, FONTS, grid, linear, pageOf, photoSlot, rule, sizeOf, solid, stroke, text, type StudioTemplate, type TemplateContext } from "./kit";

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

function habitTracker({ t }: TemplateContext) {
  const land = sizeOf(LANDSCAPE);
  const sage = "#6d8b74";
  const clay = "#c97b5a";
  const ink = "#3d3a35";
  const line = "#e5dccf";
  const labelWidth = 170;
  const day = 18;
  const totalWidth = 50;
  const tableWidth = labelWidth + day * 31 + totalWidth;
  const left = (land.width - tableWidth) / 2;
  const daysX = left + labelWidth;
  const headerY = 100;
  const rowHeight = 38;
  const band = rowHeight - 4;
  return design(t("studio.templates.items.habitTracker"), [sage, clay], [
    pageOf(LANDSCAPE, solid("#faf7f2"), [
      art("blob", { primary: "#e8efe4", secondary: "#f6e3d8" }, land.width - 240, -120, 300, 260, { opacity: 0.9 }),
      art("blob", { primary: "#f6e3d8", secondary: "#e8efe4" }, -100, land.height - 120, 240, 220, { opacity: 0.8, rotation: 90 }),
      text(left, 26, 420, 44, t("studio.tpl.extras.habitTitle"), { font: FONTS.playfair, size: 30, bold: true, color: ink, valign: "middle", shrink: true }),
      text(left, 70, 320, 22, t("studio.tpl.extras.habitSubtitle"), { font: FONTS.caveat, size: 18, bold: true, color: clay, shrink: true }),
      box("rect", left + tableWidth - 170, 38, 170, 32, solid("#ffffff"), { radius: 16, stroke: stroke(line, 1) }),
      text(left + tableWidth - 170, 38, 170, 32, t("studio.tpl.monthName"), { font: FONTS.montserrat, size: 11, bold: true, color: sage, spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      box("rect", left, headerY, tableWidth, 24, solid(sage), { radius: 8 }),
      text(left + 12, headerY, labelWidth - 20, 24, t("studio.tpl.extras.habitLabel"), { font: FONTS.montserrat, size: 9, bold: true, color: "#ffffff", spacing: 1.5, upper: true, valign: "middle", shrink: true }),
      ...Array.from({ length: 31 }, (_, index) =>
        text(daysX + index * day, headerY, day, 24, String(index + 1), { font: FONTS.inter, size: 7.5, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
      ),
      text(daysX + 31 * day, headerY, totalWidth, 24, t("studio.tpl.total"), { font: FONTS.montserrat, size: 7.5, bold: true, color: "#ffffff", upper: true, align: "center", valign: "middle", shrink: true }),
      ...Array.from({ length: 10 }, (_, row) => {
        const y = headerY + 30 + row * rowHeight;
        const named = row < 8;
        return [
          ...(row % 2 === 0 ? [box("rect", left, y, tableWidth, band, solid("#f1ece4"), { radius: 8 })] : []),
          named
            ? text(left + 12, y, labelWidth - 20, band, t(`studio.tpl.extras.habit${row + 1}`), { font: FONTS.nunito, size: 10.5, bold: true, color: ink, valign: "middle", shrink: true })
            : rule(left + 12, y + band - 9, labelWidth - 24, "#cfc6b8", 0.8),
          ...Array.from({ length: 31 }, (_, index) => box("ellipse", daysX + index * day + 3, y + band / 2 - 6, 12, 12, { type: "none" }, { stroke: stroke(index % 7 === 6 ? clay : sage, 0.8) })),
          box("rect", daysX + 31 * day + 9, y + 5, totalWidth - 18, band - 10, solid("#ffffff"), { radius: 6, stroke: stroke(line, 0.8) }),
        ];
      }).flat(),
      box("rect", left, 520, tableWidth, 50, solid("#ffffff"), { radius: 10, stroke: stroke(line, 1) }),
      text(left + 14, 520, 150, 50, t("studio.tpl.extras.habitReflection"), { font: FONTS.caveat, size: 18, bold: true, color: clay, valign: "middle", shrink: true }),
      rule(left + 170, 540, tableWidth - 190, line, 0.8),
      rule(left + 170, 558, tableWidth - 190, line, 0.8),
    ]),
  ]);
}

function budgetPlanner({ t }: TemplateContext) {
  const forest = "#1f3d2b";
  const gold = "#e9b44c";
  const ink = "#1f2a24";
  const line = "#e2ded3";
  const cardWidth = (W - 80 - 32) / 3;
  const cards: [string, string, string][] = [
    ["studio.tpl.extras.budgetIncome", "+", "#2f855a"],
    ["studio.tpl.extras.budgetExpenses", "−", "#c8553d"],
    ["studio.tpl.extras.budgetSavings", "=", "#c9971c"],
  ];
  const goals = [0.65, 0.35, 0.8];
  const goalX = W - 40 - 250;
  const categories = Array.from({ length: 10 }, (_, index) => [t(`studio.tpl.extras.budgetCat${index + 1}`), "", "", ""]);
  const tableOptions = { font: FONTS.inter, size: 9.5, color: ink, headerFill: forest, lineColor: line, zebra: "#f3f1ea" };
  return design(t("studio.templates.items.budgetPlanner"), [forest, gold], [
    pageOf(A4, solid("#fbfaf6"), [
      box("rect", 0, 0, W, 150, linear(135, forest, "#2f5d43")),
      art("arcRings", { primary: gold, secondary: "#a7f3d0" }, W - 180, -60, 230, 230, { opacity: 0.35 }),
      text(40, 34, 380, 48, t("studio.tpl.extras.budgetTitle"), { font: FONTS.playfair, size: 34, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, 84, 360, 18, t("studio.tpl.extras.budgetSubtitle"), { font: FONTS.montserrat, size: 9.5, bold: true, color: gold, spacing: 2.5, upper: true, shrink: true }),
      box("rect", 40, 110, 150, 26, solid("#ffffff"), { radius: 13, opacity: 0.14 }),
      text(40, 110, 150, 26, t("studio.tpl.monthName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: "#ffffff", spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      ...cards.flatMap(([key, symbol, colour], index) => {
        const x = 40 + index * (cardWidth + 16);
        return [
          box("rect", x, 172, cardWidth, 74, solid("#ffffff"), { radius: 12, stroke: stroke("#e7e5df", 1) }),
          box("ellipse", x + 14, 186, 28, 28, solid(colour)),
          text(x + 14, 186, 28, 28, symbol, { font: FONTS.inter, size: 16, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x + 50, 186, cardWidth - 62, 16, t(key), { font: FONTS.montserrat, size: 8.5, bold: true, color: colour, spacing: 1.2, upper: true, valign: "middle", shrink: true }),
          rule(x + 50, 228, cardWidth - 64, "#d6d3cc", 0.8),
        ];
      }),
      ...heading(40, 270, 250, t("studio.tpl.extras.budgetIncome"), forest, FONTS.montserrat),
      ...grid(
        40,
        304,
        [150, 100],
        26,
        [
          [t("studio.tpl.extras.budgetSource"), t("studio.tpl.amount")],
          [t("studio.tpl.extras.budgetSalary"), ""],
          [t("studio.tpl.extras.budgetSideIncome"), ""],
          [t("studio.tpl.extras.budgetOtherIncome"), ""],
          [t("studio.tpl.total"), ""],
        ],
        { ...tableOptions, aligns: ["left", "right"] },
      ),
      ...heading(goalX, 270, 250, t("studio.tpl.extras.budgetGoals"), forest, FONTS.montserrat),
      ...goals.flatMap((share, index) => {
        const y = 308 + index * 42;
        return [
          text(goalX, y, 250, 16, t(`studio.tpl.extras.budgetGoal${index + 1}`), { font: FONTS.inter, size: 9.5, bold: true, color: ink, valign: "middle", shrink: true }),
          box("rect", goalX, y + 20, 250, 10, solid("#ece8dd"), { radius: 5 }),
          box("rect", goalX, y + 20, 250 * share, 10, linear(90, gold, "#d08c2c"), { radius: 5 }),
        ];
      }),
      ...heading(40, 456, W - 80, t("studio.tpl.extras.budgetExpenses"), forest, FONTS.montserrat),
      ...grid(
        40,
        490,
        [W - 380, 100, 100, 100],
        24,
        [[t("studio.tpl.extras.budgetCategory"), t("studio.tpl.extras.budgetPlanned"), t("studio.tpl.extras.budgetActual"), t("studio.tpl.extras.budgetDifference")], ...categories, [t("studio.tpl.total"), "", "", ""]],
        { ...tableOptions, aligns: ["left", "right", "right", "right"] },
      ),
      text(40, 794, W - 80, 22, t("studio.tpl.extras.budgetNote"), { font: FONTS.caveat, size: 16, bold: true, color: forest, valign: "middle", shrink: true }),
    ]),
  ]);
}

export const PERSONAL_TEMPLATES: StudioTemplate[] = [
  { id: "weeklyPlanner", category: "personal", size: LANDSCAPE, build: weeklyPlanner },
  { id: "monthlyCalendar", category: "personal", size: LANDSCAPE, build: monthlyCalendar },
  { id: "recipeCard", category: "personal", size: { width: 432, height: 648 }, build: recipeCard },
  { id: "todoList", category: "personal", size: A4, build: todoList },
  { id: "habitTracker", category: "personal", size: LANDSCAPE, build: habitTracker },
  { id: "budgetPlanner", category: "personal", size: A4, build: budgetPlanner },
];
