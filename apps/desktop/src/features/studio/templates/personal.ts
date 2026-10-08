import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, design, FONTS, foil, gradient, grid, pageOf, photoSlot, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const LANDSCAPE = "a4Landscape" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;
const land = sizeOf(LANDSCAPE);
const LW = land.width;
const LH = land.height;

function faint(element: StudioElement, opacity: number): StudioElement {
  return { ...element, opacity };
}

function liftedSlot([backing, ...rest]: StudioElement[]): StudioElement[] {
  return [shadowed(backing, "lifted"), ...rest];
}

function heading(x: number, y: number, width: number, label: string, color: string, font: string, accent: string): StudioElement[] {
  return [
    text(x, y, width, 18, label, { font, size: 10.5, bold: true, color, spacing: 2, upper: true, valign: "middle", shrink: true }),
    rule(x, y + 26, width, lighter(accent, 0.55), 0.8),
    box("rect", x, y + 24, 28, 3, solid(accent)),
  ];
}

function weeklyPlanner({ t }: TemplateContext) {
  const palette = PALETTES.sageLinen;
  const deep = darker(palette.accent, 0.38);
  const brass = darker(palette.accent2, 0.5);
  const days = ["studio.tpl.monday", "studio.tpl.tuesday", "studio.tpl.wednesday", "studio.tpl.thursday", "studio.tpl.friday", "studio.tpl.saturday", "studio.tpl.sunday"];
  const side = 232;
  const left = side + 24;
  const gap = 14;
  const columnWidth = (LW - left - 28 - gap * 3) / 4;
  const cellHeight = (LH - 56 - gap) / 2;
  const noteLines = Math.floor((LH - 300) / 26);
  return design(t("studio.templates.items.weeklyPlanner"), paletteList(palette), [
    pageOf(LANDSCAPE, solid(palette.paper), [
      box("rect", 0, 0, side, LH, gradient(165, [palette.accent, deep])),
      art("topographic", { primary: "#ffffff", secondary: palette.accent2 }, 0, 0, side, LH, { opacity: 0.2 }),
      art("botanicalSprig", { primary: "#ffffff", secondary: palette.accent2 }, side - 70, 24, 44, 88, { rotation: 18, opacity: 0.5 }),
      text(28, 36, side - 64, 96, t("studio.tpl.weeklyPlanner"), { font: FONTS.playfair, size: 34, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 28, 146, 48, 3, foil("gold", 0)),
      text(28, 162, side - 56, 20, t("studio.tpl.weekOf"), { font: FONTS.inter, size: 11, color: "#f1f5ee", shrink: true }),
      box("rect", 20, 206, side - 40, LH - 232, solid(darker(deep, 0.35)), { radius: 14, opacity: 0.3, stroke: stroke(lighter(palette.accent, 0.3), 0.6) }),
      text(36, 222, side - 72, 18, t("studio.tpl.notes"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", spacing: 2, upper: true, valign: "middle", shrink: true }),
      ...Array.from({ length: noteLines }, (_, index) => faint(rule(36, 268 + index * 26, side - 72, "#ffffff", 0.7), 0.4)),
      ...[...days, "studio.tpl.goal"].flatMap((key, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = left + column * (columnWidth + gap);
        const y = 28 + row * (cellHeight + gap);
        const goal = key === "studio.tpl.goal";
        const weekend = index === 5 || index === 6;
        const lines = Math.floor((cellHeight - 56) / 24);
        return [
          shadowed(box("rect", x, y, columnWidth, cellHeight, solid(goal ? palette.soft : "#ffffff"), { radius: 12 }), "soft"),
          box("rect", x + 14, y + 16, 4, 16, solid(weekend ? palette.accent2 : palette.accent), { radius: 2 }),
          text(x + 26, y + 14, columnWidth - 40, 20, t(key), { font: FONTS.inter, size: 10.5, bold: true, color: weekend ? brass : deep, upper: true, spacing: 1.2, valign: "middle", shrink: true }),
          rule(x + 14, y + 44, columnWidth - 28, lighter(palette.accent2, 0.35), 0.8),
          ...Array.from({ length: lines }, (_, line) =>
            goal
              ? [box("rect", x + 14, y + 56 + line * 24, 11, 11, { type: "none" }, { radius: 3, stroke: stroke(palette.accent, 1) }), rule(x + 32, y + 68 + line * 24, columnWidth - 46, "#d5dccf", 0.6)]
              : [rule(x + 14, y + 68 + line * 24, columnWidth - 28, "#ebe7da", 0.6)],
          ).flat(),
        ];
      }),
    ]),
  ]);
}

function monthlyCalendar({ t }: TemplateContext) {
  const palette = PALETTES.terracotta;
  const deep = darker(palette.accent, 0.28);
  const weekendInk = darker(palette.accent, 0.3);
  const days = ["studio.tpl.mondayShort", "studio.tpl.tuesdayShort", "studio.tpl.wednesdayShort", "studio.tpl.thursdayShort", "studio.tpl.fridayShort", "studio.tpl.saturdayShort", "studio.tpl.sundayShort"].map((key) => t(key));
  const panel = 240;
  const left = 28 + panel + 28;
  const width = LW - left - 28;
  const column = width / 7;
  const headerY = 28;
  const top = headerY + 38;
  const rowHeight = (LH - 28 - top) / 6;
  const weeks = Array.from({ length: 6 }, (_, week) =>
    days.map((_, day) => {
      const date = week * 7 + day - 2;
      return date >= 1 && date <= 31 ? String(date) : "";
    }),
  );
  return design(t("studio.templates.items.monthlyCalendar"), paletteList(palette), [
    pageOf(LANDSCAPE, solid(palette.paper), [
      art("topographic", { primary: palette.accent2, secondary: palette.accent }, 0, 0, LW, LH, { opacity: 0.14 }),
      box("rect", 28 + 12, 28 + 12, panel, 250, { type: "none" }, { radius: 14, stroke: stroke(palette.accent2, 1.2) }),
      ...liftedSlot(photoSlot(28, 28, panel, 250, palette.soft, "rounded")),
      text(28, 300, panel, 62, t("studio.tpl.monthName"), { font: FONTS.playfair, size: 46, bold: true, color: deep, valign: "middle", shrink: true }),
      text(28, 362, panel, 32, "2027", { font: FONTS.playfair, size: 24, italic: true, color: darker(palette.accent2, 0.45), valign: "middle" }),
      box("rect", 28, 406, 56, 3, foil("copper", 0)),
      text(28, 424, panel, 16, t("studio.tpl.notes"), { font: FONTS.inter, size: 10, bold: true, color: palette.muted, spacing: 2, upper: true, valign: "middle", shrink: true }),
      ...Array.from({ length: 5 }, (_, index) => rule(28, 462 + index * 24, panel, "#e6d6c6", 0.7)),
      shadowed(box("rect", left, headerY, width, 30, gradient(90, [deep, darker(palette.accent, 0.4)]), { radius: 10 }), "soft"),
      ...days.map((label, index) => text(left + index * column, headerY, column, 30, label, { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true })),
      ...weeks.flatMap((week, row) =>
        week.flatMap((label, index) => {
          const x = left + index * column;
          const y = top + row * rowHeight;
          const weekend = index >= 5;
          const fill = !label ? "#f6ede3" : weekend ? palette.soft : "#ffffff";
          return [
            box("rect", x + 2, y + 2, column - 4, rowHeight - 4, solid(fill), { radius: 8, stroke: label ? stroke("#efe2d4", 0.6) : null }),
            ...(label ? [text(x + 10, y + 8, column - 20, 18, label, { font: FONTS.inter, size: 11, bold: true, color: weekend ? weekendInk : palette.ink })] : []),
          ];
        }),
      ),
    ]),
  ]);
}

function recipeCard({ t }: TemplateContext) {
  const card = { width: 432, height: 648 };
  const olive = "#606c38";
  const deep = "#283618";
  const terracotta = "#bc6c25";
  const clay = darker(terracotta, 0.3);
  const cream = "#fefae0";
  const inner = { x: 20, y: 214, width: card.width - 40, height: card.height - 234 };
  const meta: [string, string][] = [
    ["studio.tpl.prepTime", "studio.tpl.prepTimeValue"],
    ["studio.tpl.cookTime", "studio.tpl.cookTimeValue"],
    ["studio.tpl.servings", "studio.tpl.servingsValue"],
  ];
  const metaWidth = (inner.width - 48) / 3;
  const split = 206;
  return design(t("studio.templates.items.recipeCard"), [olive, terracotta, deep, cream], [
    pageOf(card, radial(cream, "#f3edc8", { cy: 0.7 }), [
      ...photoSlot(0, 0, card.width, 252, "#e9edc9"),
      shadowed(box("rect", inner.x, inner.y, inner.width, inner.height, solid("#ffffff"), { radius: 16 }), "lifted"),
      art("botanicalSprig", { primary: olive, secondary: terracotta }, card.width - 74, 186, 48, 96, { rotation: 22 }),
      text(inner.x + 28, inner.y + 22, inner.width - 84, 46, t("studio.tpl.recipeTitle"), { font: FONTS.playfair, size: 28, bold: true, color: deep, valign: "middle", shrink: true }),
      art("dotsDivider", { primary: terracotta, secondary: olive }, inner.x + 28, inner.y + 74, 120, 8),
      ...meta.flatMap(([label, value], index) => {
        const x = inner.x + 24 + index * metaWidth;
        return [
          ...(index > 0 ? [vrule(x, inner.y + 98, 40, "#e6e2cc", 0.8)] : []),
          text(x + 6, inner.y + 96, metaWidth - 12, 14, t(label), { font: FONTS.nunito, size: 8.5, bold: true, color: clay, align: "center", upper: true, spacing: 1.2, shrink: true }),
          text(x + 6, inner.y + 112, metaWidth - 12, 24, t(value), { font: FONTS.nunito, size: 14, bold: true, color: deep, align: "center", valign: "middle", shrink: true }),
        ];
      }),
      rule(inner.x + 24, inner.y + 152, inner.width - 48, "#e6e2cc", 0.8),
      ...heading(inner.x + 24, inner.y + 166, split - inner.x - 40, t("studio.tpl.ingredients"), deep, FONTS.nunito, olive),
      ...Array.from({ length: 7 }, (_, index) => {
        const y = inner.y + 206 + index * 26;
        return [box("ellipse", inner.x + 24, y + 8, 6, 6, solid(terracotta)), text(inner.x + 38, y, split - inner.x - 54, 22, t("studio.tpl.ingredient"), { font: FONTS.nunito, size: 10, color: "#3f3f1f", valign: "middle", shrink: true })];
      }).flat(),
      vrule(split, inner.y + 166 + 108, 216, "#ece8d4", 0.8),
      ...heading(split + 16, inner.y + 166, inner.x + inner.width - split - 40, t("studio.tpl.method"), deep, FONTS.nunito, olive),
      ...Array.from({ length: 4 }, (_, index) => {
        const y = inner.y + 206 + index * 48;
        return [
          box("ellipse", split + 16, y, 20, 20, solid(olive)),
          text(split + 16, y, 20, 20, String(index + 1), { font: FONTS.nunito, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(split + 44, y, inner.x + inner.width - split - 68, 42, t("studio.tpl.methodStep"), { font: FONTS.nunito, size: 9.5, color: "#3f3f1f", lineHeight: 1.35, shrink: true }),
        ];
      }).flat(),
    ]),
  ]);
}

function todoList({ t }: TemplateContext) {
  const palette = PALETTES.blushRose;
  const rose = darker(palette.accent, 0.2);
  const card = { x: 40, y: 172, width: W - 80, height: 624 };
  const notesWidth = 150;
  const listRight = card.x + card.width - notesWidth - 44;
  const rows = 16;
  const step = 36;
  const first = card.y + 30;
  return design(t("studio.templates.items.todoList"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.2, radius: 1.1 }), [
      art("marble", { primary: palette.accent2, secondary: palette.accent }, 0, 0, W, H, { opacity: 0.18 }),
      art("botanicalSprig", { primary: palette.accent, secondary: palette.accent2 }, W - 132, 34, 54, 108, { rotation: -16, opacity: 0.85 }),
      art("botanicalSprig", { primary: palette.accent2, secondary: palette.accent }, W - 92, 48, 44, 88, { rotation: 24, opacity: 0.85 }),
      text(48, 52, W - 220, 64, t("studio.tpl.todoTitle"), { font: FONTS.playfair, size: 44, bold: true, italic: true, color: palette.ink, valign: "middle", shrink: true }),
      box("rect", 48, 120, 48, 3, foil("rose", 0)),
      text(48, 134, 80, 20, t("studio.tpl.date"), { font: FONTS.inter, size: 10, bold: true, color: palette.muted, upper: true, spacing: 2, valign: "middle", shrink: true }),
      rule(132, 150, 180, lighter(palette.muted, 0.45), 0.8),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#ffffff"), { radius: 18 }), "lifted", palette.accent),
      ...Array.from({ length: 3 }, (_, index) => box("rect", card.x + 14, first + index * step - 9, listRight - card.x - 4, 34, solid(lighter(palette.soft, 0.3)), { radius: 10 })),
      ...Array.from({ length: rows }, (_, index) => {
        const y = first + index * step;
        const priority = index < 3;
        return [
          box("rect", card.x + 26, y, 16, 16, { type: "none" }, { radius: 4, stroke: stroke(priority ? palette.accent : palette.accent2, 1.4) }),
          rule(card.x + 54, y + 16, listRight - card.x - 66, "#f0e2df", 0.8),
        ];
      }).flat(),
      vrule(listRight + 20, card.y + 24, card.height - 48, "#f0e2df", 0.8),
      text(listRight + 40, first - 6, notesWidth - 10, 22, t("studio.tpl.notes"), { font: FONTS.inter, size: 10, bold: true, color: rose, upper: true, spacing: 2, valign: "middle", shrink: true }),
      box("rect", listRight + 40, first + 20, 24, 3, solid(palette.accent2)),
      ...Array.from({ length: rows - 1 }, (_, index) => rule(listRight + 40, first + 16 + (index + 1) * step, notesWidth - 16, "#f0e2df", 0.8)),
    ]),
  ]);
}

function habitTracker({ t }: TemplateContext) {
  const palette = PALETTES.emeraldBrass;
  const brass = darker(palette.accent2, 0.45);
  const line = "#dcd6c4";
  const labelWidth = 170;
  const day = 18;
  const totalWidth = 50;
  const tableWidth = labelWidth + day * 31 + totalWidth;
  const left = (LW - tableWidth) / 2;
  const daysX = left + labelWidth;
  const headerY = 104;
  const rowHeight = 38;
  const band = rowHeight - 4;
  return design(t("studio.templates.items.habitTracker"), paletteList(palette), [
    pageOf(LANDSCAPE, solid(palette.paper), [
      art("topographic", { primary: palette.accent2, secondary: lighter(palette.accent, 0.5) }, 0, 0, LW, LH, { opacity: 0.16 }),
      art("botanicalSprig", { primary: palette.accent, secondary: palette.accent2 }, left + tableWidth - 230, 18, 40, 80, { rotation: -20, opacity: 0.8 }),
      text(left, 26, 420, 44, t("studio.tpl.extras.habitTitle"), { font: FONTS.playfair, size: 30, bold: true, color: palette.ink, valign: "middle", shrink: true }),
      box("rect", left, 74, 40, 3, foil("gold", 0)),
      text(left + 52, 66, 320, 20, t("studio.tpl.extras.habitSubtitle"), { font: FONTS.playfair, size: 13, italic: true, color: brass, valign: "middle", shrink: true }),
      shadowed(box("rect", left + tableWidth - 170, 38, 170, 34, gradient(90, [palette.accent, darker(palette.accent, 0.3)]), { radius: 17 }), "soft"),
      text(left + tableWidth - 170, 38, 170, 34, t("studio.tpl.monthName"), { font: FONTS.inter, size: 11, bold: true, color: "#ffffff", spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      shadowed(box("rect", left, headerY, tableWidth, 26, gradient(90, [palette.accent, darker(palette.accent, 0.3)]), { radius: 8 }), "soft"),
      text(left + 12, headerY, labelWidth - 20, 26, t("studio.tpl.extras.habitLabel"), { font: FONTS.inter, size: 9, bold: true, color: "#ffffff", spacing: 1.5, upper: true, valign: "middle", shrink: true }),
      ...Array.from({ length: 31 }, (_, index) => text(daysX + index * day, headerY, day, 26, String(index + 1), { font: FONTS.inter, size: 7.5, bold: true, color: index % 7 === 6 ? "#f3dfb8" : "#ffffff", align: "center", valign: "middle" })),
      text(daysX + 31 * day, headerY, totalWidth, 26, t("studio.tpl.total"), { font: FONTS.inter, size: 7.5, bold: true, color: "#ffffff", upper: true, align: "center", valign: "middle", shrink: true }),
      ...Array.from({ length: 10 }, (_, row) => {
        const y = headerY + 32 + row * rowHeight;
        const named = row < 8;
        return [
          box("rect", left, y, tableWidth, band, solid(row % 2 === 0 ? palette.soft : "#ffffff"), { radius: 8, opacity: row % 2 === 0 ? 1 : 0.7 }),
          named
            ? text(left + 12, y, labelWidth - 20, band, t(`studio.tpl.extras.habit${row + 1}`), { font: FONTS.inter, size: 10, bold: true, color: palette.ink, valign: "middle", shrink: true })
            : rule(left + 12, y + band - 9, labelWidth - 24, "#b9c7bf", 0.8),
          ...Array.from({ length: 31 }, (_, index) => box("ellipse", daysX + index * day + 3, y + band / 2 - 6, 12, 12, { type: "none" }, { stroke: stroke(index % 7 === 6 ? palette.accent2 : lighter(palette.accent, 0.25), 0.8) })),
          box("rect", daysX + 31 * day + 9, y + 5, totalWidth - 18, band - 10, solid("#ffffff"), { radius: 6, stroke: stroke(line, 0.8) }),
        ];
      }).flat(),
      shadowed(box("rect", left, 522, tableWidth, 50, solid("#ffffff"), { radius: 12 }), "soft"),
      box("rect", left, 522, 5, 50, solid(palette.accent2), { radius: 2.5 }),
      text(left + 18, 522, 150, 50, t("studio.tpl.extras.habitReflection"), { font: FONTS.playfair, size: 15, bold: true, italic: true, color: palette.accent, valign: "middle", shrink: true }),
      rule(left + 176, 542, tableWidth - 196, line, 0.8),
      rule(left + 176, 560, tableWidth - 196, line, 0.8),
    ]),
  ]);
}

function budgetPlanner({ t }: TemplateContext) {
  const palette = PALETTES.forestCream;
  const forest = palette.accent;
  const gold = palette.accent2;
  const ink = palette.ink;
  const line = "#e2ded3";
  const cardWidth = (W - 80 - 32) / 3;
  const cards: [string, string, string][] = [
    ["studio.tpl.extras.budgetIncome", "+", "#276749"],
    ["studio.tpl.extras.budgetExpenses", "−", "#a63d2a"],
    ["studio.tpl.extras.budgetSavings", "=", "#8a5d0e"],
  ];
  const goals = [0.65, 0.35, 0.8];
  const goalX = W - 40 - 250;
  const categories = Array.from({ length: 10 }, (_, index) => [t(`studio.tpl.extras.budgetCat${index + 1}`), "", "", ""]);
  const tableOptions = { font: FONTS.inter, size: 9.5, color: ink, headerFill: forest, lineColor: line, zebra: "#f3f1ea" };
  return design(t("studio.templates.items.budgetPlanner"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", 0, 0, W, 150, gradient(135, [forest, darker(forest, 0.4)])),
      art("topographic", { primary: gold, secondary: "#ffffff" }, 0, 0, W, 150, { opacity: 0.2 }),
      art("arcRings", { primary: gold, secondary: "#a7f3d0" }, W - 180, -60, 230, 230, { opacity: 0.4 }),
      box("rect", 0, 150, W, 4, foil("gold", 0)),
      text(40, 32, 380, 48, t("studio.tpl.extras.budgetTitle"), { font: FONTS.playfair, size: 34, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, 82, 360, 18, t("studio.tpl.extras.budgetSubtitle"), { font: FONTS.inter, size: 9.5, bold: true, color: "#f0cf86", spacing: 2.5, upper: true, valign: "middle", shrink: true }),
      box("rect", 40, 110, 150, 26, solid("#ffffff"), { radius: 13, opacity: 0.14 }),
      text(40, 110, 150, 26, t("studio.tpl.monthName"), { font: FONTS.inter, size: 10.5, bold: true, color: "#ffffff", spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      ...cards.flatMap(([key, symbol, colour], index) => {
        const x = 40 + index * (cardWidth + 16);
        return [
          shadowed(box("rect", x, 178, cardWidth, 74, solid("#ffffff"), { radius: 12 }), "soft"),
          box("rect", x, 178, cardWidth, 4, solid(colour), { radius: 2 }),
          box("ellipse", x + 14, 194, 28, 28, solid(colour)),
          text(x + 14, 194, 28, 28, symbol, { font: FONTS.inter, size: 16, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x + 50, 194, cardWidth - 62, 16, t(key), { font: FONTS.inter, size: 8.5, bold: true, color: colour, spacing: 1.2, upper: true, valign: "middle", shrink: true }),
          rule(x + 50, 234, cardWidth - 64, "#d6d3cc", 0.8),
        ];
      }),
      ...heading(40, 276, 250, t("studio.tpl.extras.budgetIncome"), forest, FONTS.inter, gold),
      ...grid(
        40,
        310,
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
      ...heading(goalX, 276, 250, t("studio.tpl.extras.budgetGoals"), forest, FONTS.inter, gold),
      ...goals.flatMap((share, index) => {
        const y = 314 + index * 42;
        return [
          text(goalX, y, 250, 16, t(`studio.tpl.extras.budgetGoal${index + 1}`), { font: FONTS.inter, size: 9.5, bold: true, color: ink, valign: "middle", shrink: true }),
          box("rect", goalX, y + 20, 250, 10, solid("#ece8dd"), { radius: 5 }),
          box("rect", goalX, y + 20, 250 * share, 10, gradient(90, [gold, "#c0782a"]), { radius: 5 }),
        ];
      }),
      ...heading(40, 460, W - 80, t("studio.tpl.extras.budgetExpenses"), forest, FONTS.inter, gold),
      ...grid(
        40,
        494,
        [W - 380, 100, 100, 100],
        24,
        [[t("studio.tpl.extras.budgetCategory"), t("studio.tpl.extras.budgetPlanned"), t("studio.tpl.extras.budgetActual"), t("studio.tpl.extras.budgetDifference")], ...categories, [t("studio.tpl.total"), "", "", ""]],
        { ...tableOptions, aligns: ["left", "right", "right", "right"] },
      ),
      box("rect", 40, 790, W - 80, 32, solid(palette.soft), { radius: 16 }),
      text(56, 790, W - 112, 32, t("studio.tpl.extras.budgetNote"), { font: FONTS.playfair, size: 12, italic: true, color: forest, align: "center", valign: "middle", shrink: true }),
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
