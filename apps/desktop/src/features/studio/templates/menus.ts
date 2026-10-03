import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, pageOf, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const A4 = "a4" as const;
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

export const MENU_TEMPLATES: StudioTemplate[] = [
  { id: "restaurantMenu", category: "menus", size: A4, build: restaurant },
  { id: "cafeMenu", category: "menus", size: A4, build: cafe },
  { id: "weddingMenu", category: "menus", size: TALL, build: weddingMenu },
];
