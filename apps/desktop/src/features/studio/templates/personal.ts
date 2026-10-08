import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, FONTS, foil, frame, gradient, grid, pageOf, photoSlot, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const LANDSCAPE = "a4Landscape" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;
const land = sizeOf(LANDSCAPE);
const LW = land.width;
const LH = land.height;
const MA4 = 44;
const INNER_A4 = W - MA4 * 2;
const POSTER = "poster" as const;

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

function recipeIndexCard({ t }: TemplateContext) {
  const card = { width: 504, height: 360 };
  const ink = "#2b2118";
  const red = "#b8322a";
  const label = "#8f2a23";
  const blue = "#bcd0e3";
  const inset = { x: 22, y: 24, width: 460, height: 314 };
  const split = inset.x + 200;
  const firstLine = inset.y + 128;
  const step = 22;
  const lineY = (index: number) => firstLine + index * step;
  const lines = Math.floor((inset.y + inset.height - 12 - firstLine) / step) + 1;
  const leftX = inset.x + 26;
  const rightX = split + 18;
  const rightWidth = inset.x + inset.width - 22 - rightX;
  const meta: [string, string][] = [
    ["studio.tpl.servings", "studio.tpl.servingsValue"],
    ["studio.tpl.prepTime", "studio.tpl.prepTimeValue"],
    ["studio.tpl.cookTime", "studio.tpl.cookTimeValue"],
  ];
  const metaWidth = 58;
  const metaX = inset.x + inset.width - 22 - metaWidth * 3;
  return design(t("studio.templates.items.recipeIndexCard"), [red, ink, "#e9a99a", "#9cc5b8", "#fffdf6"], [
    pageOf(card, gradient(135, ["#e9dbc0", "#d8c19c"]), [
      art("topographic", { primary: "#c9ae84", secondary: "#e7d4b3" }, 0, 0, card.width, card.height, { opacity: 0.35 }),
      shadowed(box("rect", inset.x, inset.y, inset.width, inset.height, solid("#fffdf6"), { radius: 6 }), "lifted"),
      ...Array.from({ length: lines }, (_, index) => rule(inset.x + 10, lineY(index), inset.width - 20, blue, 0.7)),
      rule(inset.x + 10, inset.y + 100, inset.width - 20, red, 1.2),
      rule(inset.x + 10, inset.y + 103, inset.width - 20, red, 0.5),
      vrule(split, firstLine - step + 4, step * (lines - 1) + 4, "#e3b7b2", 0.8, "dashed"),
      box("rect", inset.x - 30, inset.y - 2, 104, 26, solid("#e9a99a"), { rotation: -33, opacity: 0.8 }),
      box("rect", inset.x + inset.width - 74, inset.y - 2, 104, 26, solid("#9cc5b8"), { rotation: 33, opacity: 0.8 }),
      art("botanicalSprig", { primary: "#6b8f71", secondary: "#c9a27e" }, inset.x + inset.width - 50, inset.y + inset.height - 92, 36, 72, { rotation: 18, opacity: 0.55 }),
      text(inset.x + 26, inset.y + 22, 230, 14, t("studio.tpl.recipeIndexCardFrom"), { font: FONTS.josefin, size: 8.5, bold: true, color: label, upper: true, spacing: 1.6, valign: "middle", shrink: true }),
      text(inset.x + 26, inset.y + 38, metaX - inset.x - 36, 52, t("studio.tpl.recipeIndexCardTitle"), { font: FONTS.caveat, size: 36, bold: true, color: ink, valign: "middle", shrink: true }),
      ...meta.flatMap(([key, value], index) => {
        const x = metaX + index * metaWidth;
        return [
          ...(index > 0 ? [vrule(x, inset.y + 40, 40, "#e6dccb", 0.8)] : []),
          text(x + 4, inset.y + 40, metaWidth - 8, 12, t(key), { font: FONTS.josefin, size: 7.5, bold: true, color: label, align: "center", upper: true, spacing: 1, valign: "middle", shrink: true }),
          text(x + 4, inset.y + 54, metaWidth - 8, 26, t(value), { font: FONTS.caveat, size: 19, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
        ];
      }),
      text(leftX, lineY(0) - 18, split - leftX - 14, 16, t("studio.tpl.ingredients"), { font: FONTS.josefin, size: 9, bold: true, color: label, upper: true, spacing: 1.8, valign: "bottom", shrink: true }),
      ...Array.from({ length: 6 }, (_, index) => text(leftX, lineY(index + 1) - 21, split - leftX - 14, 20, t("studio.tpl.ingredient"), { font: FONTS.caveat, size: 15.5, color: ink, valign: "bottom", shrink: true })),
      text(rightX, lineY(0) - 18, rightWidth, 16, t("studio.tpl.method"), { font: FONTS.josefin, size: 9, bold: true, color: label, upper: true, spacing: 1.8, valign: "bottom", shrink: true }),
      ...Array.from({ length: 3 }, (_, index) => {
        const top = lineY(1 + index * 2) - 21;
        return [
          text(rightX, top, 16, 20, `${index + 1}.`, { font: FONTS.caveat, size: 16, bold: true, color: red, valign: "bottom" }),
          text(rightX + 18, top + 3, rightWidth - 18, step * 2, t("studio.tpl.methodStep"), { font: FONTS.caveat, size: 15, color: ink, lineHeight: step / 15, shrink: true }),
        ];
      }).flat(),
    ]),
  ]);
}

function writeIn(x: number, y: number, width: number, label: string, color: string, font: string, lineColor: string): StudioElement[] {
  return [text(x, y, width, 14, label, { font, size: 8.5, bold: true, color, upper: true, spacing: 1.4, valign: "middle", shrink: true }), rule(x, y + 34, width, lineColor, 0.8)];
}

function habitChallenge({ t }: TemplateContext) {
  const plum = "#4a1d5e";
  const coral = "#c2410c";
  const muted = "#6c5970";
  const line = "#ead7dc";
  const milestones = new Set([7, 14, 21, 30]);
  const cardTop = 292;
  const cardHeight = 424;
  const cellWidth = (INNER_A4 - 40) / 5;
  const cellHeight = (cardHeight - 40) / 6;
  const circle = 50;
  const half = (INNER_A4 - 16) / 2;
  return design(t("studio.templates.items.habitChallenge"), [plum, coral, "#d4af5a", "#fff4ec"], [
    pageOf(A4, gradient(160, ["#fff4ec", "#fde8ea", "#f3e9fb"]), [
      art("arcRings", { primary: "#f0a487", secondary: "#c4a5d6" }, W - 200, -60, 250, 250, { opacity: 0.45 }),
      art("blob", { primary: "#fbd5c5", secondary: "#e7d5f3" }, -110, 360, 230, 260, { opacity: 0.55, rotation: 60 }),
      art("confetti", { primary: "#e4572e", secondary: plum }, 260, 24, 260, 130, { opacity: 0.35 }),
      text(MA4, 34, 150, 132, "30", { font: FONTS.oswald, size: 124, bold: true, color: plum, lineHeight: 1.05, valign: "middle" }),
      text(MA4 + 158, 64, INNER_A4 - 170, 48, t("studio.tpl.habitChallengeTitle"), { font: FONTS.oswald, size: 32, bold: true, color: coral, upper: true, spacing: 1, lineHeight: 1.05, valign: "middle", shrink: true }),
      text(MA4 + 160, 116, INNER_A4 - 172, 22, t("studio.tpl.habitChallengeLead"), { font: FONTS.nunito, size: 12.5, color: muted, valign: "middle", shrink: true }),
      shadowed(box("rect", MA4, 182, INNER_A4, 92, solid("#ffffff"), { radius: 16 }), "soft", plum),
      ...writeIn(MA4 + 20, 194, INNER_A4 - 40, t("studio.tpl.habitChallengeGoal"), coral, FONTS.nunito, line),
      ...writeIn(MA4 + 20, 238, 150, t("studio.tpl.habitChallengeStart"), coral, FONTS.nunito, line),
      ...writeIn(MA4 + 190, 238, INNER_A4 - 210, t("studio.tpl.habitChallengeWhy"), coral, FONTS.nunito, line),
      shadowed(box("rect", MA4, cardTop, INNER_A4, cardHeight, solid("#ffffff"), { radius: 20 }), "lifted", plum),
      box("rect", MA4, cardTop, INNER_A4, 6, gradient(90, ["#e4572e", "#d4af5a", plum]), { radius: 3 }),
      ...Array.from({ length: 30 }, (_, index) => {
        const day = index + 1;
        const cx = MA4 + 20 + (index % 5) * cellWidth + cellWidth / 2;
        const cy = cardTop + 22 + Math.floor(index / 5) * cellHeight + cellHeight / 2;
        const milestone = milestones.has(day);
        return [
          milestone ? shadowed(box("ellipse", cx - circle / 2, cy - circle / 2, circle, circle, foil("gold", 135)), "soft") : box("ellipse", cx - circle / 2, cy - circle / 2, circle, circle, solid("#fff8f4"), { stroke: stroke("#f1b7a3", 1.4) }),
          ...(milestone ? [box("ellipse", cx - circle / 2 + 4, cy - circle / 2 + 4, circle - 8, circle - 8, { type: "none" }, { stroke: stroke("#fff3c4", 0.8, "dashed") })] : []),
          text(cx - circle / 2, cy - circle / 2, circle, circle, String(day), { font: FONTS.oswald, size: milestone ? 20 : 16, bold: milestone, color: milestone ? "#3b2a06" : muted, align: "center", valign: "middle" }),
        ];
      }).flat(),
      ...["studio.tpl.habitChallengeReward", "studio.tpl.notes"].flatMap((key, index) => {
        const x = MA4 + index * (half + 16);
        const y = cardTop + cardHeight + 20;
        const height = H - 36 - y;
        return [
          shadowed(box("rect", x, y, half, height, solid("#ffffff"), { radius: 14 }), "soft"),
          box("rect", x, y + 14, 4, height - 28, solid(index ? plum : "#e4572e"), { radius: 2 }),
          ...writeIn(x + 20, y + 14, half - 40, t(key), index ? plum : coral, FONTS.nunito, line),
          rule(x + 20, y + 74, half - 40, line, 0.8),
        ];
      }),
    ]),
  ]);
}

function travelItinerary({ t }: TemplateContext) {
  const teal = "#0f5e6e";
  const deep = "#0b3440";
  const coral = "#a8432a";
  const sand = "#f7f1e5";
  const ink = "#10283a";
  const muted = "#4f6470";
  const line = "#dcdcd2";
  const cardTop = 214;
  const flightX = MA4 + INNER_A4 - 178;
  const planTop = 376;
  const columnWidth = 326;
  const sideX = MA4 + columnWidth + 22;
  const sideWidth = MA4 + INNER_A4 - sideX;
  const dayStep = 104;
  const days = [1, 2, 3, 4];
  const times = ["09:00", "13:00", "19:30"];
  const packing = ["studio.tpl.travelItineraryPack1", "studio.tpl.travelItineraryPack2", "studio.tpl.travelItineraryPack3", "studio.tpl.travelItineraryPack4"];
  return design(t("studio.templates.items.travelItinerary"), [teal, coral, deep, sand], [
    pageOf(A4, solid(sand), [
      ...photoSlot(0, 0, W, 290, "#cfe3e6"),
      shadowed(box("rect", MA4, cardTop, INNER_A4, 136, solid("#ffffff"), { radius: 18 }), "lifted"),
      text(MA4 + 24, cardTop + 20, flightX - MA4 - 44, 14, t("studio.tpl.travelItineraryLabel"), { font: FONTS.inter, size: 9, bold: true, color: teal, upper: true, spacing: 2.2, valign: "middle", shrink: true }),
      text(MA4 + 24, cardTop + 38, flightX - MA4 - 44, 50, t("studio.tpl.travelItineraryDestination"), { font: FONTS.playfair, size: 32, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", MA4 + 24, cardTop + 94, 40, 3, solid(coral), { radius: 1.5 }),
      text(MA4 + 24, cardTop + 104, flightX - MA4 - 44, 18, t("studio.tpl.travelItineraryDates"), { font: FONTS.inter, size: 11, color: muted, valign: "middle", shrink: true }),
      vrule(flightX - 10, cardTop + 18, 100, "#cfd8d6", 1, "dashed"),
      box("ellipse", flightX - 18, cardTop - 8, 16, 16, solid(sand)),
      box("ellipse", flightX - 18, cardTop + 128, 16, 16, solid(sand)),
      text(flightX + 8, cardTop + 22, 56, 12, t("studio.tpl.from"), { font: FONTS.inter, size: 8, bold: true, color: muted, upper: true, spacing: 1.2, valign: "middle", shrink: true }),
      text(flightX + 8, cardTop + 36, 56, 36, "IST", { font: FONTS.oswald, size: 28, bold: true, color: teal, valign: "middle" }),
      box("arrow", flightX + 68, cardTop + 48, 34, 14, solid(coral)),
      text(flightX + 110, cardTop + 22, 58, 12, t("studio.tpl.to"), { font: FONTS.inter, size: 8, bold: true, color: muted, upper: true, spacing: 1.2, valign: "middle", shrink: true }),
      text(flightX + 110, cardTop + 36, 58, 36, "LIS", { font: FONTS.oswald, size: 28, bold: true, color: teal, valign: "middle" }),
      box("rect", flightX + 8, cardTop + 86, 160, 30, solid("#eaf3f2"), { radius: 8 }),
      text(flightX + 8, cardTop + 86, 160, 30, "TP 1754 · 09:40", { font: FONTS.oswald, size: 13, color: deep, align: "center", valign: "middle", spacing: 1.5 }),
      ...heading(MA4, planTop, columnWidth, t("studio.tpl.travelItineraryPlan"), deep, FONTS.inter, coral),
      vrule(MA4 + 26, planTop + 70, dayStep * 3, "#9cc3c4", 1.2, "dotted"),
      ...days.flatMap((day, index) => {
        const y = planTop + 44 + index * dayStep;
        return [
          shadowed(box("rect", MA4, y, 52, 58, gradient(160, [teal, deep]), { radius: 12 }), "soft"),
          text(MA4 + 4, y + 8, 44, 12, t("studio.tpl.travelItineraryDay"), { font: FONTS.inter, size: 7.5, bold: true, color: "#cdeae8", align: "center", upper: true, spacing: 1, valign: "middle", shrink: true }),
          text(MA4, y + 20, 52, 32, String(day).padStart(2, "0"), { font: FONTS.oswald, size: 24, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(MA4 + 66, y, columnWidth - 66, 20, t(`studio.tpl.travelItineraryDay${day}`), { font: FONTS.playfair, size: 14, bold: true, color: ink, valign: "middle", shrink: true }),
          ...times.flatMap((time, slot) => [
            text(MA4 + 66, y + 26 + slot * 22, 40, 16, time, { font: FONTS.inter, size: 9, bold: true, color: coral, valign: "middle" }),
            rule(MA4 + 110, y + 40 + slot * 22, columnWidth - 110, line, 0.8),
          ]),
        ];
      }),
      shadowed(box("rect", sideX, planTop, sideWidth, 136, solid("#ffffff"), { radius: 14 }), "soft"),
      ...heading(sideX + 16, planTop + 16, sideWidth - 32, t("studio.tpl.travelItineraryStay"), deep, FONTS.inter, coral),
      text(sideX + 16, planTop + 54, sideWidth - 32, 22, t("studio.tpl.travelItineraryHotel"), { font: FONTS.playfair, size: 14, bold: true, color: ink, valign: "middle", shrink: true }),
      rule(sideX + 16, planTop + 98, sideWidth - 32, line, 0.8),
      rule(sideX + 16, planTop + 120, sideWidth - 32, line, 0.8),
      shadowed(box("rect", sideX, planTop + 152, sideWidth, H - 40 - planTop - 152, gradient(170, [teal, deep]), { radius: 14 }), "soft"),
      art("topographic", { primary: "#ffffff", secondary: "#9cc3c4" }, sideX, planTop + 152, sideWidth, H - 40 - planTop - 152, { opacity: 0.14 }),
      text(sideX + 16, planTop + 168, sideWidth - 32, 18, t("studio.tpl.travelItineraryPacking"), { font: FONTS.inter, size: 10.5, bold: true, color: "#ffffff", upper: true, spacing: 2, valign: "middle", shrink: true }),
      box("rect", sideX + 16, planTop + 192, 28, 3, solid("#f2b49f"), { radius: 1.5 }),
      ...Array.from({ length: 7 }, (_, index) => {
        const y = planTop + 210 + index * 28;
        const label = packing[index];
        return [
          box("rect", sideX + 16, y + 3, 12, 12, { type: "none" }, { radius: 3, stroke: stroke("#cdeae8", 1) }),
          label ? text(sideX + 36, y, sideWidth - 52, 18, t(label), { font: FONTS.inter, size: 10, color: "#ffffff", valign: "middle", shrink: true }) : rule(sideX + 36, y + 15, sideWidth - 52, "#5f8f97", 0.8),
        ];
      }).flat(),
    ]),
  ]);
}

function weeklyBudget({ t }: TemplateContext) {
  const ink = "#1f2328";
  const coral = "#ff6b57";
  const coralInk = "#b93a2b";
  const mint = "#2a9d8f";
  const sun = "#e9c46a";
  const line = "#e3e1da";
  const panel = 254;
  const px = 28;
  const pw = panel - px * 2;
  const right = panel + 24;
  const areaWidth = LW - 28 - right;
  const gap = 8;
  const dayWidth = (areaWidth - gap * 6) / 7;
  const dayTop = 28;
  const dayHeight = 352;
  const days = ["studio.tpl.mondayShort", "studio.tpl.tuesdayShort", "studio.tpl.wednesdayShort", "studio.tpl.thursdayShort", "studio.tpl.fridayShort", "studio.tpl.saturdayShort", "studio.tpl.sundayShort"].map((key) => t(key));
  const split: [string, string, number, string][] = [
    ["studio.tpl.weeklyBudgetNeeds", "50%", 0.5, mint],
    ["studio.tpl.weeklyBudgetWants", "30%", 0.3, sun],
    ["studio.tpl.extras.budgetSavings", "20%", 0.2, coral],
  ];
  const summary = ["studio.tpl.extras.budgetIncome", "studio.tpl.weeklyBudgetSpent", "studio.tpl.weeklyBudgetLeft"];
  const lowerTop = dayTop + dayHeight + 20;
  const lowerHeight = LH - 28 - lowerTop;
  const billsWidth = 300;
  const spendX = right + billsWidth + 14;
  const spendWidth = LW - 28 - spendX;
  const dot = 22;
  const dotGap = (spendWidth - 40 - dot * 7) / 6;
  let barX = px;
  return design(t("studio.templates.items.weeklyBudget"), [ink, coral, mint, sun, "#f7f6f2"], [
    pageOf(LANDSCAPE, solid("#f7f6f2"), [
      art("halftone", { primary: "#d9d5ca", secondary: "#e9e5db" }, panel, 0, LW - panel, LH, { opacity: 0.35 }),
      box("rect", 0, 0, panel, LH, gradient(165, ["#2c3342", "#12161e"])),
      art("diagonalHatch", { primary: "#ffffff", secondary: "#94a3b8" }, 0, 0, panel, LH, { opacity: 0.08 }),
      art("arcRings", { primary: coral, secondary: sun }, panel - 120, -60, 180, 180, { opacity: 0.35 }),
      text(px, 34, pw, 14, t("studio.tpl.weeklyBudgetKicker"), { font: FONTS.inter, size: 9, bold: true, color: "#ffb3a7", upper: true, spacing: 2.2, valign: "middle", shrink: true }),
      text(px, 52, pw, 76, t("studio.tpl.weeklyBudgetTitle"), { font: FONTS.montserrat, size: 30, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "middle", shrink: true }),
      text(px, 134, pw, 18, t("studio.tpl.weekOf"), { font: FONTS.inter, size: 11, color: "#d1d5db", valign: "middle", shrink: true }),
      box("rect", px, 170, pw, 72, solid("#ffffff"), { radius: 14, opacity: 0.07, stroke: stroke("#4b5563", 0.8) }),
      text(px + 16, 182, pw - 32, 14, t("studio.tpl.weeklyBudgetLimit"), { font: FONTS.inter, size: 8.5, bold: true, color: "#ffb3a7", upper: true, spacing: 1.4, valign: "middle", shrink: true }),
      rule(px + 16, 226, pw - 32, "#6b7280", 0.8),
      text(px, 266, pw, 16, t("studio.tpl.weeklyBudgetSplit"), { font: FONTS.montserrat, size: 11, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      ...split.map(([, , share, colour]) => {
        const element = box("rect", barX, 292, pw * share - 3, 12, solid(colour), { radius: 6 });
        barX += pw * share;
        return element;
      }),
      ...split.flatMap(([key, percent, , colour], index) => {
        const y = 318 + index * 24;
        return [
          box("ellipse", px, y + 4, 10, 10, solid(colour)),
          text(px + 18, y, pw - 70, 18, t(key), { font: FONTS.inter, size: 10.5, color: "#e5e7eb", valign: "middle", shrink: true }),
          text(px + pw - 50, y, 50, 18, percent, { font: FONTS.montserrat, size: 11, bold: true, color: "#ffffff", align: "right", valign: "middle" }),
        ];
      }),
      rule(px, 406, pw, "#374151", 0.8),
      ...summary.flatMap((key, index) => {
        const y = 422 + index * 46;
        return [text(px, y, pw, 14, t(key), { font: FONTS.inter, size: 8.5, bold: true, color: "#cbd5e1", upper: true, spacing: 1.4, valign: "middle", shrink: true }), rule(px, y + 34, pw, "#6b7280", 0.8)];
      }),
      ...days.flatMap((label, index) => {
        const x = right + index * (dayWidth + gap);
        const weekend = index >= 5;
        return [
          shadowed(box("rect", x, dayTop, dayWidth, dayHeight, solid("#ffffff"), { radius: 12 }), "soft"),
          box("rect", x + 6, dayTop + 6, dayWidth - 12, 28, weekend ? gradient(90, [coralInk, "#9a2f22"]) : gradient(90, ["#2c3342", "#12161e"]), { radius: 8 }),
          text(x + 6, dayTop + 6, dayWidth - 12, 28, label, { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", align: "center", upper: true, spacing: 1.4, valign: "middle", shrink: true }),
          ...Array.from({ length: 8 }, (_, line) => rule(x + 10, dayTop + 68 + line * 30, dayWidth - 20, "#e7e4dc", 0.8)),
          text(x + 6, dayTop + 290, dayWidth - 12, 14, t("studio.tpl.total"), { font: FONTS.inter, size: 7.5, bold: true, color: "#5f666d", align: "center", upper: true, spacing: 1.2, valign: "middle", shrink: true }),
          box("rect", x + 6, dayTop + 308, dayWidth - 12, 34, solid(weekend ? "#fdeeea" : "#f1efe9"), { radius: 8 }),
        ];
      }),
      shadowed(box("rect", right, lowerTop, billsWidth, lowerHeight, solid("#ffffff"), { radius: 12 }), "soft"),
      ...heading(right + 18, lowerTop + 14, billsWidth - 36, t("studio.tpl.weeklyBudgetBills"), ink, FONTS.inter, coral),
      ...Array.from({ length: 4 }, (_, index) => {
        const y = lowerTop + 56 + index * 26;
        return [box("rect", right + 18, y, 11, 11, { type: "none" }, { radius: 3, stroke: stroke(mint, 1.1) }), rule(right + 36, y + 12, billsWidth - 130, line, 0.8), rule(right + billsWidth - 84, y + 12, 66, line, 0.8)];
      }).flat(),
      shadowed(box("rect", spendX, lowerTop, spendWidth, lowerHeight, solid("#ffffff"), { radius: 12 }), "soft"),
      ...heading(spendX + 20, lowerTop + 14, spendWidth - 40, t("studio.tpl.weeklyBudgetNoSpend"), ink, FONTS.inter, mint),
      ...days.flatMap((label, index) => {
        const x = spendX + 20 + index * (dot + dotGap);
        return [
          box("ellipse", x, lowerTop + 58, dot, dot, solid("#f3faf8"), { stroke: stroke(mint, 1.2) }),
          text(x - 4, lowerTop + 88, dot + 8, 14, label, { font: FONTS.inter, size: 7.5, bold: true, color: "#5f666d", align: "center", upper: true, valign: "middle", shrink: true }),
        ];
      }),
      text(spendX + 20, lowerTop + 116, 150, 16, t("studio.tpl.weeklyBudgetSaved"), { font: FONTS.inter, size: 8.5, bold: true, color: "#1f6f66", upper: true, spacing: 1.2, valign: "middle", shrink: true }),
      rule(spendX + 20, lowerTop + 150, spendWidth - 40, line, 0.8),
    ]),
  ]);
}

function seatingChart({ t }: TemplateContext) {
  const size = sizeOf(POSTER);
  const sage = "#5f7f66";
  const deep = "#2f3e34";
  const muted = "#6b6258";
  const goldInk = "#80601f";
  const margin = 84;
  const gap = 22;
  const cardWidth = (size.width - margin * 2 - gap * 2) / 3;
  const cardHeight = 226;
  const top = 340;
  const seats = 8;
  return design(t("studio.templates.items.seatingChart"), [sage, deep, "#e8c4b8", "#c9a24a", "#fbf7f2"], [
    pageOf(POSTER, radial("#fdfaf6", "#efe6da", { cy: 0.3, radius: 1.1 }), [
      art("marble", { primary: "#e8c4b8", secondary: "#cfd8c9" }, 0, 0, size.width, size.height, { opacity: 0.16 }),
      frame("ornateFrame", { primary: sage, secondary: "#c9a24a" }, size),
      art("botanicalSprig", { primary: sage, secondary: "#c9a24a" }, 112, 96, 60, 120, { rotation: -28, opacity: 0.9 }),
      art("botanicalSprig", { primary: sage, secondary: "#e8c4b8" }, size.width - 172, 96, 60, 120, { rotation: 28, opacity: 0.9 }),
      centredText(size, 92, 110, t("studio.tpl.seatingChartTitle"), { font: FONTS.greatVibes, size: 78, color: deep, valign: "middle", shrink: true, inset: 190 }),
      centredText(size, 208, 38, t("studio.tpl.coupleNames"), { font: FONTS.cormorant, size: 26, bold: true, color: "#4a6551", upper: true, spacing: 6, valign: "middle", shrink: true, inset: 150 }),
      centredText(size, 250, 24, t("studio.tpl.weddingDate"), { font: FONTS.cormorant, size: 17, italic: true, color: muted, valign: "middle", shrink: true, inset: 150 }),
      art("flourishDivider", { primary: sage, secondary: "#c9a24a" }, size.width / 2 - 140, 288, 280, 36),
      ...Array.from({ length: 9 }, (_, index) => {
        const x = margin + (index % 3) * (cardWidth + gap);
        const y = top + Math.floor(index / 3) * (cardHeight + gap);
        const cx = x + 52;
        const cy = y + 54;
        return [
          shadowed(box("rect", x, y, cardWidth, cardHeight, solid("#ffffff"), { radius: 14, stroke: stroke("#eadfce", 0.8) }), "soft"),
          ...Array.from({ length: seats }, (__, seat) => {
            const angle = (seat / seats) * Math.PI * 2;
            return box("ellipse", cx + Math.cos(angle) * 31 - 4.5, cy + Math.sin(angle) * 31 - 4.5, 9, 9, solid(sage));
          }),
          box("ellipse", cx - 22, cy - 22, 44, 44, solid("#f6e3dc"), { stroke: stroke("#c9a24a", 1) }),
          text(x + 100, y + 26, cardWidth - 116, 16, t("studio.tpl.table"), { font: FONTS.cormorant, size: 12, bold: true, color: goldInk, upper: true, spacing: 3, valign: "middle", shrink: true }),
          text(x + 100, y + 42, cardWidth - 116, 50, String(index + 1), { font: FONTS.greatVibes, size: 46, color: deep, valign: "middle" }),
          box("rect", x + 24, y + 104, cardWidth - 48, 1.2, foil("gold", 0)),
          ...Array.from({ length: seats }, (__, guest) => text(x + 16, y + 110 + guest * 14.5, cardWidth - 32, 14.5, t("studio.tpl.seatingChartGuest"), { font: FONTS.cormorant, size: 12.5, italic: true, color: muted, align: "center", valign: "middle", lineHeight: 1.1, shrink: true })),
        ];
      }).flat(),
      centredText(size, top + (cardHeight + gap) * 3 + 2, 26, t("studio.tpl.reception"), { font: FONTS.cormorant, size: 17, italic: true, color: deep, valign: "middle", shrink: true, inset: 150 }),
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
  { id: "recipeIndexCard", category: "personal", size: { width: 504, height: 360 }, build: recipeIndexCard },
  { id: "habitChallenge", category: "personal", size: A4, build: habitChallenge },
  { id: "travelItinerary", category: "personal", size: A4, build: travelItinerary },
  { id: "weeklyBudget", category: "personal", size: LANDSCAPE, build: weeklyBudget },
  { id: "seatingChart", category: "personal", size: POSTER, build: seatingChart },
];
