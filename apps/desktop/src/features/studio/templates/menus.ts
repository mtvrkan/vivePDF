import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, linear, pageOf, photoSlot, rule, sizeOf, solid, stroke, text, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const A4 = "a4" as const;
const A5 = "a5" as const;
const TALL: TemplateSize = { width: 288, height: 648 };

type DishStyle = { font: string; nameColor: string; textColor: string; priceColor: string; dots?: string };

function dishes(t: TemplateContext["t"], x: number, y: number, width: number, count: number, style: DishStyle, gap = 48): StudioElement[] {
  return Array.from({ length: count }, (_, index) => {
    const top = y + index * gap;
    return [
      text(x, top, width - 70, 20, t("studio.tpl.dishName"), { font: style.font, size: 13, bold: true, color: style.nameColor, shrink: true }),
      ...(style.dots ? [rule(x, top + 16, width - 70, style.dots, 0.6, "dotted")] : []),
      text(x + width - 64, top, 64, 20, t("studio.tpl.price"), { font: style.font, size: 13, bold: true, color: style.priceColor, align: "right", shrink: true }),
      text(x, top + 20, width - 70, 18, t("studio.tpl.dishDescription"), { font: style.font, size: 10, italic: true, color: style.textColor, shrink: true }),
    ];
  }).flat();
}

function restaurant({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const wine = "#7f1d1d";
  const gold = "#b08d57";
  const style: DishStyle = { font: FONTS.cormorant, nameColor: "#1f2937", textColor: "#6b7280", priceColor: wine, dots: "#d6c7ad" };
  const column = (page.width - 120) / 2;
  const section = (x: number, y: number, key: string, count: number) => [
    text(x, y, column, 26, t(key), { font: FONTS.cinzel, size: 16, bold: true, color: wine, spacing: 3, upper: true }),
    rule(x, y + 30, 40, gold, 1.5),
    ...dishes(t, x, y + 44, column - 28, count, style),
  ];
  return design(t("studio.templates.items.restaurantMenu"), [wine, gold], [
    pageOf(A4, solid("#fdfaf3"), [
      frame("doubleFrame", { primary: wine, secondary: gold }, page),
      centredText(page, 70, 46, t("studio.tpl.restaurantName"), { font: FONTS.cinzel, size: 34, bold: true, color: wine, spacing: 4, upper: true, shrink: true }),
      centredText(page, 118, 22, t("studio.tpl.menu"), { font: FONTS.greatVibes, size: 24, color: gold, shrink: true }),
      art("flourishDivider", { primary: wine, secondary: gold }, page.width / 2 - 90, 146, 180, 22),
      ...section(60, 190, "studio.tpl.starters", 4),
      ...section(60 + column, 190, "studio.tpl.mains", 4),
      ...section(60, 470, "studio.tpl.desserts", 3),
      ...section(60 + column, 470, "studio.tpl.drinks", 3),
      centredText(page, page.height - 82, 18, t("studio.tpl.menuFooter"), { font: FONTS.cormorant, size: 11, italic: true, color: "#6b7280", shrink: true }),
    ]),
  ]);
}

function cafe({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const coffee = "#6f4e37";
  const cream = "#f5ebe0";
  const mint = "#2f855a";
  const style: DishStyle = { font: FONTS.poppins, nameColor: "#2b2118", textColor: "#7c6a5a", priceColor: mint };
  const block = (x: number, y: number, key: string, count: number) => [
    box("rect", x, y, 230, 30, solid(coffee), { radius: 15 }),
    text(x, y, 230, 30, t(key), { font: FONTS.poppins, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
    ...dishes(t, x + 4, y + 44, 222, count, style, 44),
  ];
  return design(t("studio.templates.items.cafeMenu"), [coffee, mint], [
    pageOf(A4, solid(cream), [
      art("blob", { primary: "#e6ccb2", secondary: "#ddb892" }, -90, -80, 320, 300, { opacity: 0.8 }),
      art("blob", { primary: "#b7e4c7", secondary: "#d8f3dc" }, page.width - 200, page.height - 230, 300, 300, { opacity: 0.7, rotation: 120 }),
      centredText(page, 60, 70, t("studio.tpl.cafeName"), { font: FONTS.pacifico, size: 46, color: coffee, shrink: true, valign: "middle" }),
      centredText(page, 132, 20, t("studio.tpl.cafeTagline"), { font: FONTS.poppins, size: 12, color: "#7c6a5a", spacing: 3, upper: true, shrink: true }),
      ...block(50, 180, "studio.tpl.coffee", 5),
      ...block(page.width - 280, 180, "studio.tpl.tea", 3),
      ...block(page.width - 280, 380, "studio.tpl.pastries", 3),
      ...block(50, 470, "studio.tpl.breakfast", 4),
      centredText(page, page.height - 70, 20, t("studio.tpl.website"), { font: FONTS.poppins, size: 11, color: coffee, shrink: true }),
    ]),
  ]);
}

function weddingMenu({ t }: TemplateContext) {
  const page = sizeOf(TALL);
  const sage = "#5f7161";
  const gold = "#b08d57";
  const courses = ["studio.tpl.starters", "studio.tpl.mains", "studio.tpl.desserts"];
  return design(t("studio.templates.items.weddingMenu"), [sage, gold], [
    pageOf(TALL, solid("#fbf8f3"), [
      frame("ornateFrame", { primary: sage, secondary: gold }, page),
      centredText(page, 70, 24, t("studio.tpl.menu"), { font: FONTS.cormorant, size: 14, color: gold, spacing: 8, upper: true, shrink: true }),
      centredText(page, 96, 60, t("studio.tpl.coupleNames"), { font: FONTS.greatVibes, size: 30, color: sage, lineHeight: 1.05, shrink: true, valign: "middle", inset: 30 }),
      art("flourishDivider", { primary: sage, secondary: gold }, page.width / 2 - 60, 164, 120, 18),
      ...courses.flatMap((key, index) => {
        const y = 200 + index * 120;
        return [
          centredText(page, y, 22, t(key), { font: FONTS.cormorant, size: 14, bold: true, color: sage, spacing: 4, upper: true, shrink: true }),
          centredText(page, y + 28, 20, t("studio.tpl.dishName"), { font: FONTS.cormorant, size: 13, bold: true, color: "#1f2937", shrink: true, inset: 40 }),
          centredText(page, y + 48, 18, t("studio.tpl.dishDescription"), { font: FONTS.cormorant, size: 10.5, italic: true, color: "#6b7280", shrink: true, inset: 40 }),
          centredText(page, y + 72, 20, t("studio.tpl.dishName"), { font: FONTS.cormorant, size: 13, bold: true, color: "#1f2937", shrink: true, inset: 40 }),
          centredText(page, y + 92, 18, t("studio.tpl.dishDescription"), { font: FONTS.cormorant, size: 10.5, italic: true, color: "#6b7280", shrink: true, inset: 40 }),
        ];
      }),
      centredText(page, 568, 18, t("studio.tpl.weddingDate"), { font: FONTS.cormorant, size: 11, color: gold, spacing: 2, upper: true, shrink: true, inset: 40 }),
    ]),
  ]);
}

function burgerMenu({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const charcoal = "#1c1917";
  const red = "#dc2626";
  const mustard = "#facc15";
  const muted = "#a8a29e";
  const left = 40;
  const width = 300;
  const right = 372;
  const rightWidth = page.width - right - 40;
  const burgers = [11, 14, 15, 12];
  const tag = (x: number, y: number, label: string): StudioElement[] => [
    box("parallelogram", x, y, 170, 34, solid(mustard)),
    text(x + 14, y, 142, 34, label, { font: FONTS.bebas, size: 24, color: charcoal, align: "center", valign: "middle", spacing: 1.5, shrink: true }),
  ];
  const shortList = (prefix: string, prices: number[], y: number): StudioElement[] =>
    prices.flatMap((price, index) => {
      const top = y + index * 36;
      return [
        text(right, top, rightWidth - 44, 22, t(`${prefix}${index + 1}`), { font: FONTS.oswald, size: 13, bold: true, color: "#ffffff", upper: true, valign: "middle", shrink: true }),
        text(right + rightWidth - 40, top - 2, 40, 26, String(price), { font: FONTS.bebas, size: 22, color: mustard, align: "right", valign: "middle" }),
        rule(right, top + 28, rightWidth, "#44403c", 0.8, "dotted"),
      ];
    });
  return design(t("studio.templates.items.burgerMenu"), [red, mustard], [
    pageOf(A4, solid(charcoal), [
      box("rect", 0, 0, page.width, 268, linear(135, "#ef4444", "#b91c1c")),
      art("arcRings", { primary: mustard, secondary: "#fecaca" }, -70, -70, 240, 240, { opacity: 0.3 }),
      box("rect", -40, 236, page.width + 80, 64, solid(charcoal), { rotation: -4 }),
      text(left, 40, 300, 16, t("studio.tpl.extras.burgerKicker"), { font: FONTS.montserrat, size: 10, bold: true, color: "#fde68a", spacing: 3, upper: true, shrink: true }),
      text(left, 58, 310, 118, t("studio.tpl.extras.burgerTitle"), { font: FONTS.bebas, size: 66, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true }),
      text(left, 180, 290, 26, t("studio.tpl.extras.burgerTagline"), { font: FONTS.caveat, size: 22, bold: true, color: mustard, shrink: true }),
      box("ellipse", page.width - 238, 28, 200, 200, { type: "none" }, { stroke: stroke(mustard, 2.5, "dashed") }),
      ...photoSlot(page.width - 228, 38, 180, 180, "#fca5a5", "circle"),
      box("burst", page.width - 128, 150, 96, 96, solid(mustard), { points: 14, inner: 0.8, rotation: -12 }),
      text(page.width - 124, 176, 88, 44, t("studio.tpl.extras.burgerBadge"), { font: FONTS.bebas, size: 24, color: "#b91c1c", align: "center", valign: "middle", rotation: -12, shrink: true }),
      ...tag(left, 304, t("studio.tpl.extras.burgerSection")),
      ...burgers.flatMap((price, index) => {
        const top = 356 + index * 72;
        return [
          text(left, top, width - 70, 22, t(`studio.tpl.extras.burgerName${index + 1}`), { font: FONTS.oswald, size: 16, bold: true, color: "#ffffff", upper: true, spacing: 0.5, valign: "middle", shrink: true }),
          text(left + width - 64, top - 3, 64, 28, String(price), { font: FONTS.bebas, size: 28, color: mustard, align: "right", valign: "middle" }),
          text(left, top + 25, width - 70, 30, t(`studio.tpl.extras.burgerDesc${index + 1}`), { font: FONTS.inter, size: 9.5, color: muted, lineHeight: 1.35, shrink: true }),
          ...(index < burgers.length - 1 ? [rule(left, top + 62, width, "#44403c", 0.8, "dashed")] : []),
        ];
      }),
      ...tag(right, 304, t("studio.tpl.extras.burgerSides")),
      ...shortList("studio.tpl.extras.burgerSide", [4, 5, 3], 356),
      ...tag(right, 476, t("studio.tpl.drinks")),
      ...shortList("studio.tpl.extras.burgerDrink", [3, 4, 6], 528),
      box("rect", left, 660, page.width - left * 2, 100, linear(90, red, "#991b1b"), { radius: 16 }),
      art("confetti", { primary: mustard, secondary: "#fecaca" }, left + 250, 666, 150, 88, { opacity: 0.3 }),
      text(left + 24, 676, 330, 16, t("studio.tpl.extras.burgerComboLabel"), { font: FONTS.montserrat, size: 10, bold: true, color: "#fde68a", spacing: 3, upper: true, shrink: true }),
      text(left + 24, 694, 340, 52, t("studio.tpl.extras.burgerCombo"), { font: FONTS.bebas, size: 30, color: "#ffffff", lineHeight: 0.95, valign: "middle", shrink: true }),
      box("ellipse", page.width - left - 108, 668, 84, 84, solid(mustard)),
      text(page.width - left - 108, 668, 84, 84, "15", { font: FONTS.bebas, size: 44, color: "#b91c1c", align: "center", valign: "middle" }),
      centredText(page, 782, 18, `${t("studio.tpl.address")}  ·  ${t("studio.tpl.phone")}`, { font: FONTS.inter, size: 9.5, color: muted, shrink: true, inset: 40 }),
    ]),
  ]);
}

function cocktailMenu({ t }: TemplateContext) {
  const page = sizeOf(TALL);
  const gold = "#d4af37";
  const teal = "#2dd4bf";
  const cream = "#f5e6c4";
  const mist = "#9fb3c8";
  const centre = page.width / 2;
  const prices = [14, 13, 15, 12, 13, 16];
  const colours = { primary: gold, secondary: teal };
  return design(t("studio.templates.items.cocktailMenu"), [gold, "#0f766e"], [
    pageOf(TALL, linear(180, "#10263a", "#06121d"), [
      frame("decoFrame", colours, page),
      box("triangle", centre - 15, 36, 30, 22, solid(gold), { rotation: 180 }),
      box("ellipse", centre + 2, 38, 7, 7, solid(teal)),
      box("rect", centre - 1, 57, 2, 13, solid(gold)),
      box("ellipse", centre - 10, 68, 20, 4, solid(gold)),
      centredText(page, 80, 16, t("studio.tpl.extras.cocktailKicker"), { font: FONTS.cinzel, size: 9, color: gold, spacing: 4, upper: true, shrink: true, inset: 36 }),
      centredText(page, 96, 44, t("studio.tpl.extras.cocktailScript"), { font: FONTS.greatVibes, size: 34, color: cream, valign: "middle", shrink: true, inset: 32 }),
      centredText(page, 138, 34, t("studio.tpl.extras.cocktailTitle"), { font: FONTS.cinzel, size: 24, bold: true, color: gold, spacing: 5, upper: true, valign: "middle", shrink: true, inset: 32 }),
      art("diamondDivider", colours, centre - 60, 180, 120, 10),
      ...prices.flatMap((price, index) => {
        const y = 202 + index * 58;
        return [
          centredText(page, y, 18, t(`studio.tpl.extras.cocktailName${index + 1}`), { font: FONTS.cinzel, size: 12, bold: true, color: cream, spacing: 1.5, valign: "middle", shrink: true, inset: 40 }),
          centredText(page, y + 18, 16, t(`studio.tpl.extras.cocktailMix${index + 1}`), { font: FONTS.cormorant, size: 11.5, italic: true, color: mist, shrink: true, inset: 40 }),
          centredText(page, y + 35, 16, String(price), { font: FONTS.cinzel, size: 11, bold: true, color: gold, inset: 40 }),
        ];
      }),
      art("diamondDivider", colours, centre - 60, 556, 120, 10),
      centredText(page, 574, 18, t("studio.tpl.extras.cocktailHappyHour"), { font: FONTS.cormorant, size: 12, bold: true, italic: true, color: cream, shrink: true, inset: 40 }),
      centredText(page, 596, 14, t("studio.tpl.extras.cocktailNote"), { font: FONTS.cinzel, size: 7.5, color: mist, spacing: 2, upper: true, shrink: true, inset: 44 }),
    ]),
  ]);
}

function dessertMenu({ t }: TemplateContext) {
  const page = sizeOf(A5);
  const berry = "#be185d";
  const cocoa = "#4a2c21";
  const soft = "#8a6f66";
  const prices = [7, 8, 6, 7, 8, 12];
  const gutter = 24;
  const column = (page.width - 96 - gutter) / 2;
  return design(t("studio.templates.items.dessertMenu"), [berry, cocoa], [
    pageOf(A5, solid("#fdf2f4"), [
      art("blob", { primary: "#fbcfe8", secondary: "#fde68a" }, -70, -60, 230, 210, { opacity: 0.7 }),
      art("blob", { primary: "#d9f99d", secondary: "#bbf7d0" }, page.width - 150, page.height - 170, 220, 220, { opacity: 0.6, rotation: 200 }),
      art("scallopSeal", { primary: "#f9a8d4", secondary: "#ffffff" }, page.width / 2 - 82, 30, 164, 164),
      ...photoSlot(page.width / 2 - 62, 50, 124, 124, "#fce7f3", "circle"),
      centredText(page, 206, 14, t("studio.tpl.extras.dessertKicker"), { font: FONTS.montserrat, size: 8.5, bold: true, color: berry, spacing: 3.5, upper: true, shrink: true, inset: 40 }),
      centredText(page, 222, 46, t("studio.tpl.extras.dessertTitle"), { font: FONTS.playfair, size: 30, bold: true, italic: true, color: cocoa, valign: "middle", shrink: true, inset: 30 }),
      art("dotsDivider", { primary: berry, secondary: berry }, page.width / 2 - 50, 272, 100, 8),
      ...prices.flatMap((price, index) => {
        const x = 48 + (index % 2) * (column + gutter);
        const y = 294 + Math.floor(index / 2) * 64;
        return [
          text(x, y, column - 42, 18, t(`studio.tpl.extras.dessertName${index + 1}`), { font: FONTS.playfair, size: 12, bold: true, color: cocoa, valign: "middle", shrink: true }),
          box("rect", x + column - 34, y + 1, 34, 17, solid(berry), { radius: 8.5 }),
          text(x + column - 34, y + 1, 34, 17, String(price), { font: FONTS.montserrat, size: 9, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x, y + 20, column, 30, t(`studio.tpl.extras.dessertDesc${index + 1}`), { font: FONTS.lora, size: 9, italic: true, color: soft, lineHeight: 1.35, shrink: true }),
        ];
      }),
      box("rect", 40, 492, page.width - 80, 52, solid("#ffffff"), { radius: 26, stroke: stroke("#f9a8d4", 1) }),
      box("heart", 62, 509, 20, 18, solid(berry)),
      text(94, 492, page.width - 154, 52, t("studio.tpl.extras.dessertPairing"), { font: FONTS.lora, size: 10.5, italic: true, color: cocoa, valign: "middle", lineHeight: 1.3, shrink: true }),
      centredText(page, 558, 16, t("studio.tpl.website"), { font: FONTS.montserrat, size: 8.5, color: berry, spacing: 2, shrink: true, inset: 40 }),
    ]),
  ]);
}

export const MENU_TEMPLATES: StudioTemplate[] = [
  { id: "restaurantMenu", category: "menus", size: A4, build: restaurant },
  { id: "cafeMenu", category: "menus", size: A4, build: cafe },
  { id: "weddingMenu", category: "menus", size: TALL, build: weddingMenu },
  { id: "burgerMenu", category: "menus", size: A4, build: burgerMenu },
  { id: "cocktailMenu", category: "menus", size: TALL, build: cocktailMenu },
  { id: "dessertMenu", category: "menus", size: A5, build: dessertMenu },
];
