import type { StudioElement, StudioFill } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, photoSlot, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const A5 = "a5" as const;
const TALL: TemplateSize = { width: 288, height: 648 };

type DishStyle = { font: string; nameColor: string; textColor: string; priceColor: string; separator?: string; nameSize?: number; textSize?: number; priceFont?: string };

function dishes(t: TemplateContext["t"], x: number, y: number, width: number, count: number, style: DishStyle, gap = 48): StudioElement[] {
  const nameSize = style.nameSize ?? 13;
  const textSize = style.textSize ?? 10;
  return Array.from({ length: count }, (_, index) => {
    const top = y + index * gap;
    return [
      text(x, top, width - 76, 20, t("studio.tpl.dishName"), { font: style.font, size: nameSize, bold: true, color: style.nameColor, valign: "middle", shrink: true }),
      text(x + width - 72, top, 72, 20, t("studio.tpl.price"), { font: style.priceFont ?? style.font, size: nameSize, bold: true, color: style.priceColor, align: "right", valign: "middle", shrink: true }),
      text(x, top + 21, width - 24, 16, t("studio.tpl.dishDescription"), { font: style.font, size: textSize, italic: true, color: style.textColor, shrink: true }),
      ...(style.separator && index < count - 1 ? [rule(x, top + gap - 6, width, style.separator, 0.6)] : []),
    ];
  }).flat();
}

function arch(x: number, y: number, width: number, height: number, fill: StudioFill, options: Parameters<typeof box>[6] = {}) {
  return { ...box("rect", x, y, width, height, fill, options), corners: [width / 2, width / 2, 0, 0] as [number, number, number, number] };
}

function restaurant({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const { width: W, height: H } = page;
  const palette = PALETTES.burgundyGold;
  const wine = palette.accent;
  const gold = palette.accent2;
  const cream = "#f8ecd9";
  const header = 216;
  const margin = 56;
  const gutter = 48;
  const column = (W - margin * 2 - gutter) / 2;
  const style: DishStyle = { font: FONTS.cormorant, nameColor: palette.ink, textColor: palette.muted, priceColor: wine, separator: lighter(gold, 0.55), nameSize: 14.5, textSize: 11 };
  const section = (x: number, y: number, key: string, count: number) => [
    text(x, y, column, 24, t(key), { font: FONTS.cinzel, size: 15, bold: true, color: wine, spacing: 3, upper: true, valign: "middle", shrink: true }),
    box("rect", x, y + 30, 36, 1.5, foil("gold", 0)),
    ...dishes(t, x, y + 46, column, count, style, 50),
  ];
  return design(t("studio.templates.items.restaurantMenu"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.6, radius: 1.1 }), [
      box("rect", 0, 0, W, header, gradient(160, [wine, darker(wine, 0.5)])),
      art("diagonalHatch", { primary: "#ffffff", secondary: gold }, 0, 0, W, header, { opacity: 0.14 }),
      box("rect", 0, header, W, 4, foil("gold", 0)),
      box("rect", 28, header + 28, W - 56, H - header - 56, { type: "none" }, { stroke: stroke(lighter(gold, 0.2), 0.6) }),
      box("diamond", 22, header + 22, 12, 12, foil("gold", 135)),
      box("diamond", W - 34, header + 22, 12, 12, foil("gold", 135)),
      box("diamond", 22, H - 40, 12, 12, foil("gold", 135)),
      box("diamond", W - 34, H - 40, 12, 12, foil("gold", 135)),
      centredText(page, 52, 64, t("studio.tpl.restaurantName"), { font: FONTS.cinzel, size: 42, bold: true, color: cream, spacing: 7, upper: true, shrink: true, valign: "middle", inset: 64 }),
      centredText(page, 116, 48, t("studio.tpl.menu"), { font: FONTS.greatVibes, size: 36, color: "#e8cc96", shrink: true, valign: "middle", inset: 120 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 90, 172, 180, 12),
      shadowed(art("waxSeal", { primary: wine, secondary: gold }, W / 2 - 34, header - 32, 68, 68), "lifted"),
      ...section(margin, 284, "studio.tpl.starters", 4),
      ...section(margin + column + gutter, 284, "studio.tpl.mains", 4),
      vrule(W / 2, 288, 228, lighter(gold, 0.35), 0.6),
      vrule(W / 2, 580, 156, lighter(gold, 0.35), 0.6),
      art("flourishDivider", { primary: wine, secondary: gold }, W / 2 - 70, 538, 140, 20),
      ...section(margin, 576, "studio.tpl.desserts", 3),
      ...section(margin + column + gutter, 576, "studio.tpl.drinks", 3),
      centredText(page, 772, 20, t("studio.tpl.menuFooter"), { font: FONTS.cormorant, size: 12, italic: true, color: palette.muted, shrink: true, valign: "middle", inset: 72 }),
    ]),
  ]);
}

function cafe({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const { width: W, height: H } = page;
  const palette = PALETTES.mochaCream;
  const coffee = palette.accent;
  const caramel = palette.accent2;
  const margin = 40;
  const gutter = 24;
  const column = (W - margin * 2 - gutter) / 2;
  const right = margin + column + gutter;
  const style: DishStyle = { font: FONTS.poppins, nameColor: palette.ink, textColor: palette.muted, priceColor: coffee, separator: palette.soft, nameSize: 12, textSize: 9 };
  const card = (x: number, y: number, key: string, count: number): StudioElement[] => [
    shadowed(box("rect", x, y, column, 56 + count * 44 + 4, solid("#ffffff"), { radius: 16 }), "soft", coffee),
    text(x + 20, y + 16, column - 40, 24, t(key), { font: FONTS.poppins, size: 13, bold: true, color: coffee, spacing: 2.5, upper: true, valign: "middle", shrink: true }),
    box("rect", x + 20, y + 44, 32, 2.5, foil("copper", 0), { radius: 1.25 }),
    ...dishes(t, x + 20, y + 58, column - 40, count, style, 44),
  ];
  const [photoBacking, photo] = photoSlot(right, 184, column, 132, palette.soft, "rounded");
  return design(t("studio.templates.items.cafeMenu"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.25, radius: 1.1 }), [
      art("halftone", { primary: caramel, secondary: coffee }, 0, 0, W, H, { opacity: 0.2 }),
      art("blob", { primary: caramel, secondary: palette.soft }, -110, -110, 300, 280, { opacity: 0.35 }),
      art("brushStroke", { primary: caramel, secondary: caramel }, margin - 8, 118, 280, 44, { opacity: 0.35 }),
      text(margin, 40, W - 240, 80, t("studio.tpl.cafeName"), { font: FONTS.pacifico, size: 50, color: coffee, shrink: true, valign: "middle" }),
      text(margin + 8, 128, 300, 22, t("studio.tpl.cafeTagline"), { font: FONTS.poppins, size: 11, bold: true, color: palette.ink, spacing: 3, upper: true, valign: "middle", shrink: true }),
      shadowed(box("ellipse", W - 164, 32, 124, 124, gradient(135, [coffee, darker(coffee, 0.35)])), "lifted", coffee),
      box("ellipse", W - 156, 40, 108, 108, { type: "none" }, { stroke: stroke(caramel, 1, "dashed") }),
      text(W - 150, 70, 96, 48, t("studio.tpl.menu"), { font: FONTS.pacifico, size: 26, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      ...card(margin, 184, "studio.tpl.coffee", 5),
      ...card(margin, 488, "studio.tpl.breakfast", 4),
      shadowed(photoBacking, "soft", coffee),
      photo,
      ...card(right, 336, "studio.tpl.tea", 3),
      ...card(right, 552, "studio.tpl.pastries", 3),
      box("rect", 0, H - 48, W, 48, gradient(0, [darker(coffee, 0.2), coffee])),
      box("rect", 0, H - 50, W, 2, foil("copper", 0)),
      centredText(page, H - 48, 48, t("studio.tpl.website"), { font: FONTS.poppins, size: 11, bold: true, color: "#f8ecd9", spacing: 2, valign: "middle", shrink: true }),
    ]),
  ]);
}

function weddingMenu({ t }: TemplateContext) {
  const page = sizeOf(TALL);
  const { width: W, height: H } = page;
  const palette = PALETTES.sageLinen;
  const sage = darker(palette.accent, 0.25);
  const gold = palette.accent2;
  const goldInk = darker(gold, 0.5);
  const colours = { primary: palette.accent, secondary: gold };
  const courses = ["studio.tpl.starters", "studio.tpl.mains", "studio.tpl.desserts"];
  const x = 20;
  const y = 24;
  return design(t("studio.templates.items.weddingMenu"), paletteList(palette), [
    pageOf(TALL, radial("#fdfcf7", palette.soft, { cy: 0.35, radius: 1.1 }), [
      art("marble", { primary: lighter(palette.accent, 0.5), secondary: lighter(gold, 0.25) }, 0, 0, W, H, { opacity: 0.6 }),
      shadowed(arch(x, y, W - x * 2, H - y * 2, solid("#fffefa"), { stroke: stroke(gold, 0.8) }), "lifted"),
      arch(x + 8, y + 8, W - x * 2 - 16, H - y * 2 - 16, { type: "none" }, { stroke: stroke(lighter(gold, 0.2), 0.4) }),
      art("botanicalSprig", colours, W / 2 - 50, 34, 30, 60, { rotation: -60 }),
      art("botanicalSprig", colours, W / 2 + 20, 34, 30, 60, { rotation: 60 }),
      box("ellipse", W / 2 - 3, 60, 6, 6, foil("gold", 135)),
      centredText(page, 84, 18, t("studio.tpl.menu"), { font: FONTS.cormorant, size: 12, bold: true, color: goldInk, spacing: 6, upper: true, shrink: true, valign: "middle", inset: 56 }),
      centredText(page, 104, 56, t("studio.tpl.coupleNames"), { font: FONTS.greatVibes, size: 32, color: sage, lineHeight: 1, shrink: true, valign: "middle", inset: 36 }),
      art("flourishDivider", colours, W / 2 - 56, 164, 112, 16),
      ...courses.flatMap((key, index) => {
        const top = 196 + index * 124;
        return [
          centredText(page, top, 20, t(key), { font: FONTS.cormorant, size: 12.5, bold: true, color: sage, spacing: 4, upper: true, shrink: true, valign: "middle", inset: 40 }),
          box("rect", W / 2 - 14, top + 24, 28, 1, foil("gold", 0)),
          centredText(page, top + 32, 18, t("studio.tpl.dishName"), { font: FONTS.cormorant, size: 13.5, bold: true, color: palette.ink, shrink: true, valign: "middle", inset: 40 }),
          centredText(page, top + 50, 16, t("studio.tpl.dishDescription"), { font: FONTS.cormorant, size: 11, italic: true, color: palette.muted, shrink: true, inset: 40 }),
          centredText(page, top + 72, 18, t("studio.tpl.dishName"), { font: FONTS.cormorant, size: 13.5, bold: true, color: palette.ink, shrink: true, valign: "middle", inset: 40 }),
          centredText(page, top + 90, 16, t("studio.tpl.dishDescription"), { font: FONTS.cormorant, size: 11, italic: true, color: palette.muted, shrink: true, inset: 40 }),
        ];
      }),
      art("botanicalSprig", colours, 34, H - 112, 26, 52, { rotation: -30, opacity: 0.85 }),
      art("botanicalSprig", colours, W - 60, H - 112, 26, 52, { rotation: 30, opacity: 0.85 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 48, 562, 96, 8),
      centredText(page, 578, 18, t("studio.tpl.weddingDate"), { font: FONTS.cormorant, size: 10.5, bold: true, color: goldInk, spacing: 2, upper: true, shrink: true, valign: "middle", inset: 56 }),
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
    shadowed(box("parallelogram", x, y, 170, 34, solid(mustard)), "long", "#000000"),
    text(x + 14, y, 142, 34, label, { font: FONTS.bebas, size: 24, color: charcoal, align: "center", valign: "middle", spacing: 1.5, shrink: true }),
  ];
  const shortList = (prefix: string, prices: number[], y: number): StudioElement[] =>
    prices.flatMap((price, index) => {
      const top = y + index * 36;
      return [
        text(right, top, rightWidth - 44, 22, t(`${prefix}${index + 1}`), { font: FONTS.bebas, size: 18, color: "#ffffff", spacing: 1, valign: "middle", shrink: true }),
        text(right + rightWidth - 40, top - 2, 40, 26, String(price), { font: FONTS.bebas, size: 22, color: mustard, align: "right", valign: "middle" }),
        rule(right, top + 28, rightWidth, "#44403c", 0.8, "dotted"),
      ];
    });
  return design(t("studio.templates.items.burgerMenu"), [red, mustard, charcoal], [
    pageOf(A4, radial("#292524", charcoal, { cy: 0.6, radius: 1 }), [
      art("diagonalHatch", { primary: "#44403c", secondary: "#292524" }, 0, 268, page.width, page.height - 268, { opacity: 0.35 }),
      box("rect", 0, 0, page.width, 268, gradient(135, ["#ef4444", "#b91c1c"])),
      art("halftone", { primary: "#7f1d1d", secondary: "#fca5a5" }, 0, 0, page.width, 268, { opacity: 0.3 }),
      art("arcRings", { primary: mustard, secondary: "#fecaca" }, -70, -70, 240, 240, { opacity: 0.3 }),
      box("rect", -40, 236, page.width + 80, 64, solid(charcoal), { rotation: -4 }),
      text(left, 40, 300, 16, t("studio.tpl.extras.burgerKicker"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", spacing: 3, upper: true, shrink: true }),
      text(left, 58, 310, 118, t("studio.tpl.extras.burgerTitle"), { font: FONTS.bebas, size: 66, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true, shadow: "deep" }),
      text(left, 180, 290, 26, t("studio.tpl.extras.burgerTagline"), { font: FONTS.bebas, size: 24, color: mustard, spacing: 1, shrink: true }),
      box("ellipse", page.width - 238, 28, 200, 200, { type: "none" }, { stroke: stroke(mustard, 2.5, "dashed") }),
      ...(([backing, image]) => [shadowed(backing, "lifted"), image])(photoSlot(page.width - 228, 38, 180, 180, "#fca5a5", "circle")),
      shadowed(box("burst", page.width - 128, 150, 96, 96, solid(mustard), { points: 14, inner: 0.8, rotation: -12 }), "soft"),
      text(page.width - 124, 176, 88, 44, t("studio.tpl.extras.burgerBadge"), { font: FONTS.bebas, size: 24, color: "#b91c1c", align: "center", valign: "middle", rotation: -12, shrink: true }),
      ...tag(left, 304, t("studio.tpl.extras.burgerSection")),
      ...burgers.flatMap((price, index) => {
        const top = 356 + index * 72;
        return [
          text(left, top, width - 70, 22, t(`studio.tpl.extras.burgerName${index + 1}`), { font: FONTS.bebas, size: 22, color: "#ffffff", spacing: 1, valign: "middle", shrink: true }),
          text(left + width - 64, top - 3, 64, 28, String(price), { font: FONTS.bebas, size: 28, color: mustard, align: "right", valign: "middle" }),
          text(left, top + 25, width - 70, 30, t(`studio.tpl.extras.burgerDesc${index + 1}`), { font: FONTS.inter, size: 9.5, color: muted, lineHeight: 1.35, shrink: true }),
          ...(index < burgers.length - 1 ? [rule(left, top + 62, width, "#44403c", 0.8, "dashed")] : []),
        ];
      }),
      ...tag(right, 304, t("studio.tpl.extras.burgerSides")),
      ...shortList("studio.tpl.extras.burgerSide", [4, 5, 3], 356),
      ...tag(right, 476, t("studio.tpl.drinks")),
      ...shortList("studio.tpl.extras.burgerDrink", [3, 4, 6], 528),
      shadowed(box("rect", left, 660, page.width - left * 2, 100, gradient(90, [red, "#991b1b"]), { radius: 16 }), "lifted", "#000000"),
      art("confetti", { primary: mustard, secondary: "#fecaca" }, left + 250, 666, 150, 88, { opacity: 0.3 }),
      text(left + 24, 676, 330, 16, t("studio.tpl.extras.burgerComboLabel"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", spacing: 3, upper: true, shrink: true }),
      text(left + 24, 694, 340, 52, t("studio.tpl.extras.burgerCombo"), { font: FONTS.bebas, size: 30, color: "#ffffff", lineHeight: 0.95, valign: "middle", shrink: true }),
      shadowed(box("ellipse", page.width - left - 108, 668, 84, 84, solid(mustard)), "soft"),
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
  const mist = "#a9bccf";
  const centre = page.width / 2;
  const prices = [14, 13, 15, 12, 13, 16];
  const colours = { primary: gold, secondary: teal };
  return design(t("studio.templates.items.cocktailMenu"), [gold, "#0f766e", "#10263a", cream], [
    pageOf(TALL, radial("#18354f", "#050e17", { cy: 0.22, radius: 1.1 }), [
      art("sunburst", { primary: "#1f3d5c", secondary: gold }, -page.width * 0.5, -180, page.width * 2, 520, { opacity: 0.18 }),
      frame("decoFrame", colours, page),
      shadowed(box("triangle", centre - 15, 36, 30, 22, foil("gold", 90), { rotation: 180 }), "glow", gold),
      box("ellipse", centre + 2, 38, 7, 7, solid(teal)),
      box("rect", centre - 1, 57, 2, 13, foil("gold", 0)),
      box("ellipse", centre - 10, 68, 20, 4, foil("gold", 0)),
      centredText(page, 80, 16, t("studio.tpl.extras.cocktailKicker"), { font: FONTS.cinzel, size: 9, bold: true, color: gold, spacing: 4, upper: true, shrink: true, inset: 36 }),
      centredText(page, 96, 44, t("studio.tpl.extras.cocktailScript"), { font: FONTS.greatVibes, size: 36, color: cream, valign: "middle", shrink: true, inset: 32 }),
      centredText(page, 138, 34, t("studio.tpl.extras.cocktailTitle"), { font: FONTS.cinzel, size: 24, bold: true, color: gold, spacing: 5, upper: true, valign: "middle", shrink: true, inset: 32 }),
      art("diamondDivider", colours, centre - 60, 180, 120, 10),
      ...prices.flatMap((price, index) => {
        const y = 202 + index * 58;
        return [
          centredText(page, y, 18, t(`studio.tpl.extras.cocktailName${index + 1}`), { font: FONTS.cinzel, size: 12, bold: true, color: cream, spacing: 1.5, valign: "middle", shrink: true, inset: 40 }),
          centredText(page, y + 18, 16, t(`studio.tpl.extras.cocktailMix${index + 1}`), { font: FONTS.cormorant, size: 11.5, italic: true, color: mist, shrink: true, inset: 40 }),
          box("rect", centre - 17, y + 36, 34, 14, solid("#0b1a28"), { radius: 7, stroke: stroke(gold, 0.6) }),
          centredText(page, y + 36, 14, String(price), { font: FONTS.cinzel, size: 9.5, bold: true, color: gold, valign: "middle", inset: centre - 17 }),
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
  const soft = "#765a52";
  const prices = [7, 8, 6, 7, 8, 12];
  const gutter = 24;
  const column = (page.width - 96 - gutter) / 2;
  const [photoBacking, photo] = photoSlot(page.width / 2 - 62, 50, 124, 124, "#fce7f3", "circle");
  return design(t("studio.templates.items.dessertMenu"), [berry, cocoa, "#fdf2f4", "#f9a8d4"], [
    pageOf(A5, radial("#fff7f9", "#fbe4ea", { cy: 0.3, radius: 1 }), [
      art("halftone", { primary: "#f9a8d4", secondary: "#fde68a" }, 0, 0, page.width, page.height, { opacity: 0.25 }),
      art("blob", { primary: "#fbcfe8", secondary: "#fde68a" }, -70, -60, 230, 210, { opacity: 0.7 }),
      art("blob", { primary: "#d9f99d", secondary: "#bbf7d0" }, page.width - 150, page.height - 170, 220, 220, { opacity: 0.6, rotation: 200 }),
      shadowed(art("scallopSeal", { primary: "#f9a8d4", secondary: "#ffffff" }, page.width / 2 - 82, 30, 164, 164), "lifted", berry),
      shadowed(photoBacking, "soft", berry),
      photo,
      centredText(page, 206, 14, t("studio.tpl.extras.dessertKicker"), { font: FONTS.montserrat, size: 8.5, bold: true, color: berry, spacing: 3.5, upper: true, shrink: true, inset: 40 }),
      centredText(page, 222, 46, t("studio.tpl.extras.dessertTitle"), { font: FONTS.playfair, size: 30, bold: true, italic: true, color: cocoa, valign: "middle", shrink: true, inset: 30 }),
      art("dotsDivider", { primary: berry, secondary: berry }, page.width / 2 - 50, 272, 100, 8),
      ...prices.flatMap((price, index) => {
        const x = 48 + (index % 2) * (column + gutter);
        const y = 294 + Math.floor(index / 2) * 64;
        return [
          text(x, y, column - 42, 18, t(`studio.tpl.extras.dessertName${index + 1}`), { font: FONTS.playfair, size: 12, bold: true, color: cocoa, valign: "middle", shrink: true }),
          box("rect", x + column - 34, y + 1, 34, 17, gradient(90, [berry, "#9d174d"]), { radius: 8.5 }),
          text(x + column - 34, y + 1, 34, 17, String(price), { font: FONTS.montserrat, size: 9, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x, y + 20, column, 30, t(`studio.tpl.extras.dessertDesc${index + 1}`), { font: FONTS.playfair, size: 9, italic: true, color: soft, lineHeight: 1.35, shrink: true }),
        ];
      }),
      shadowed(box("rect", 40, 492, page.width - 80, 52, solid("#ffffff"), { radius: 26, stroke: stroke("#f9a8d4", 1) }), "soft", berry),
      box("heart", 62, 509, 20, 18, solid(berry)),
      text(94, 492, page.width - 154, 52, t("studio.tpl.extras.dessertPairing"), { font: FONTS.playfair, size: 10.5, italic: true, color: cocoa, valign: "middle", lineHeight: 1.3, shrink: true }),
      centredText(page, 558, 16, t("studio.tpl.website"), { font: FONTS.montserrat, size: 8.5, bold: true, color: berry, spacing: 2, shrink: true, inset: 40 }),
    ]),
  ]);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function fineDining({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const { width: W, height: H } = page;
  const ink = "#1c1b1a";
  const muted = "#5f5a52";
  const gold = "#b8893b";
  const goldInk = darker(gold, 0.42);
  const paper = "#fbf9f4";
  const numeralX = 80;
  const lineX = 160;
  const textX = 182;
  const textWidth = W - textX - 84;
  const top = 240;
  const gap = 76;
  return design(t("studio.templates.items.fineDiningMenu"), [ink, gold, paper, muted], [
    pageOf(A4, radial(paper, "#eee7da", { cy: 0.3, radius: 1.1 }), [
      art("guillocheRosette", { primary: "#e6d9bd", secondary: "#eee4cf" }, W / 2 - 160, -160, 320, 320, { opacity: 0.7 }),
      box("rect", 28, 28, W - 56, H - 56, { type: "none" }, { stroke: stroke(gold, 0.7) }),
      box("rect", 34, 34, W - 68, H - 68, { type: "none" }, { stroke: stroke(gold, 0.3) }),
      ...[
        [28, 28],
        [W - 28, 28],
        [28, H - 28],
        [W - 28, H - 28],
      ].map(([x = 0, y = 0]) => box("diamond", x - 6, y - 6, 12, 12, foil("gold", 135))),
      centredText(page, 72, 20, t("studio.tpl.restaurantName"), { font: FONTS.cormorant, size: 13, bold: true, color: ink, spacing: 8, upper: true, valign: "middle", shrink: true, inset: 120 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 50, 98, 100, 8),
      centredText(page, 112, 72, t("studio.tpl.fineDiningMenuTitle"), { font: FONTS.cormorant, size: 54, italic: true, color: ink, valign: "middle", shrink: true, inset: 80 }),
      centredText(page, 186, 16, t("studio.tpl.fineDiningMenuLead"), { font: FONTS.montserrat, size: 8.5, bold: true, color: muted, spacing: 3, upper: true, valign: "middle", shrink: true, inset: 90 }),
      vrule(lineX, top - 6, gap * 5 + 40, lighter(gold, 0.15), 0.6),
      ...ROMAN.flatMap((numeral, index) => {
        const y = top + index * gap;
        return [
          text(numeralX, y - 8, 60, 40, numeral, { font: FONTS.cormorant, size: 30, italic: true, color: goldInk, align: "right", valign: "middle" }),
          shadowed(box("diamond", lineX - 4, y + 8, 8, 8, foil("gold", 135)), "soft"),
          text(textX, y, textWidth, 18, t(`studio.tpl.fineDiningMenuCourse${index + 1}`), { font: FONTS.montserrat, size: 11, bold: true, color: ink, spacing: 2.2, upper: true, valign: "middle", shrink: true }),
          text(textX, y + 22, textWidth, 38, t(`studio.tpl.fineDiningMenuNote${index + 1}`), { font: FONTS.cormorant, size: 15.5, italic: true, color: muted, lineHeight: 1.25, shrink: true }),
        ];
      }),
      box("rect", W / 2 - 60, 712, 120, 1.2, foil("gold", 0)),
      centredText(page, 724, 26, t("studio.tpl.fineDiningMenuPrice"), { font: FONTS.cormorant, size: 17, bold: true, color: ink, valign: "middle", shrink: true, inset: 80 }),
      centredText(page, 754, 18, t("studio.tpl.menuFooter"), { font: FONTS.cormorant, size: 12, italic: true, color: muted, valign: "middle", shrink: true, inset: 90 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 40, 784, 80, 8),
    ]),
  ]);
}

function chalkboard({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const { width: W, height: H } = page;
  const slate = "#262c2b";
  const chalk = "#f4f1e8";
  const yellow = "#fde68a";
  const pink = "#f9a8d4";
  const mint = "#99f6e4";
  const dust = "#6b7371";
  const inset = 22;
  const left = 62;
  const column = 220;
  const right = W - left - column;
  const item = (x: number, y: number, key: string, price: number): StudioElement[] => [
    text(x, y, column - 44, 26, t(key), { font: FONTS.caveat, size: 21, bold: true, color: chalk, valign: "middle", shrink: true }),
    text(x + column - 40, y, 40, 26, String(price), { font: FONTS.caveat, size: 22, bold: true, color: yellow, align: "right", valign: "middle" }),
    rule(x, y + 30, column, dust, 0.8, "dotted"),
  ];
  const heading = (x: number, y: number, key: string, color: string): StudioElement[] => [
    text(x, y, column, 42, t(key), { font: FONTS.caveat, size: 34, bold: true, color, valign: "middle", shrink: true }),
    art("brushStroke", { primary: color, secondary: color }, x - 4, y + 40, 110, 9, { opacity: 0.5 }),
  ];
  const coffees = [3, 3, 4, 4, 4, 5, 5];
  return design(t("studio.templates.items.chalkboardMenu"), [slate, chalk, yellow, pink, mint], [
    pageOf(A4, gradient(135, ["#9a6a3a", "#6b4423", "#8a5a2e"]), [
      art("diagonalHatch", { primary: "#4a2e16", secondary: "#4a2e16" }, 0, 0, W, H, { opacity: 0.25 }),
      shadowed(box("rect", inset, inset, W - inset * 2, H - inset * 2, radial("#363e3c", "#1c2120", { cy: 0.4, radius: 1.1 }), { radius: 4 }), "lifted", "#000000"),
      art("marble", { primary: "#4b5452", secondary: "#3d4543" }, inset, inset, W - inset * 2, H - inset * 2, { opacity: 0.45 }),
      box("rect", inset + 12, inset + 12, W - inset * 2 - 24, H - inset * 2 - 24, { type: "none" }, { radius: 2, stroke: stroke("#5d6563", 0.8, "dashed") }),
      ...[0, 10, 20].map((offset) => box("rect", 76 + offset, 58, 3, 16, solid(chalk), { radius: 1.5, opacity: 0.7, rotation: offset === 10 ? -10 : 10 })),
      box("rect", 70, 80, 40, 30, { type: "none" }, { stroke: stroke(chalk, 2) }),
      box("ellipse", 104, 84, 18, 18, { type: "none" }, { stroke: stroke(chalk, 2) }),
      box("ellipse", 62, 108, 56, 8, { type: "none" }, { stroke: stroke(chalk, 2) }),
      box("star", W - 120, 58, 34, 34, { type: "none" }, { stroke: stroke(yellow, 1.8), opacity: 0.9 }),
      box("star", W - 82, 92, 20, 20, { type: "none" }, { stroke: stroke(pink, 1.6), opacity: 0.9 }),
      box("star", W - 136, 100, 14, 14, { type: "none" }, { stroke: stroke(mint, 1.4), opacity: 0.9 }),
      centredText(page, 50, 72, t("studio.tpl.cafeName"), { font: FONTS.caveat, size: 62, bold: true, color: chalk, valign: "middle", shrink: true, inset: 140 }),
      centredText(page, 124, 18, t("studio.tpl.chalkboardMenuKicker"), { font: FONTS.josefin, size: 10, bold: true, color: yellow, spacing: 3, upper: true, valign: "middle", shrink: true, inset: 130 }),
      art("dotsDivider", { primary: chalk, secondary: chalk }, W / 2 - 60, 152, 120, 8),
      ...heading(left, 178, "studio.tpl.coffee", pink),
      ...coffees.flatMap((price, index) => item(left, 236 + index * 44, `studio.tpl.chalkboardMenuCoffee${index + 1}`, price)),
      ...heading(right, 178, "studio.tpl.tea", mint),
      ...[3, 3, 4].flatMap((price, index) => item(right, 236 + index * 44, `studio.tpl.chalkboardMenuTea${index + 1}`, price)),
      ...heading(right, 384, "studio.tpl.pastries", yellow),
      ...[3, 4, 3].flatMap((price, index) => item(right, 442 + index * 44, `studio.tpl.chalkboardMenuTreat${index + 1}`, price)),
      box("rect", left, 600, W - left * 2, 140, { type: "none" }, { radius: 18, stroke: stroke(chalk, 1.6, "dashed") }),
      text(left + 24, 616, W - left * 2 - 180, 44, t("studio.tpl.chalkboardMenuSpecialLabel"), { font: FONTS.caveat, size: 34, bold: true, color: pink, valign: "middle", shrink: true }),
      text(left + 24, 664, W - left * 2 - 180, 56, t("studio.tpl.chalkboardMenuSpecial"), { font: FONTS.josefin, size: 13, color: chalk, lineHeight: 1.4, shrink: true }),
      box("burst", W - left - 132, 614, 112, 112, { type: "none" }, { points: 16, inner: 0.82, stroke: stroke(yellow, 2) }),
      text(W - left - 132, 614, 112, 112, "6", { font: FONTS.caveat, size: 48, bold: true, color: yellow, align: "center", valign: "middle" }),
      centredText(page, 764, 20, t("studio.tpl.website"), { font: FONTS.josefin, size: 9.5, bold: true, color: chalk, spacing: 3, valign: "middle", shrink: true, inset: 90 }),
    ]),
  ]);
}

function citrus(cx: number, cy: number, radius: number, rind: string, flesh: string): StudioElement[] {
  const pith = "#fff7ed";
  const inner = radius * 0.8;
  return [
    shadowed(box("ellipse", cx - radius, cy - radius, radius * 2, radius * 2, solid(rind)), "soft", darker(rind, 0.3)),
    box("ellipse", cx - radius * 0.9, cy - radius * 0.9, radius * 1.8, radius * 1.8, solid(pith)),
    box("ellipse", cx - inner, cy - inner, inner * 2, inner * 2, radial(lighter(flesh, 0.3), flesh)),
    ...Array.from({ length: 5 }, (_, index) => box("line", cx - inner, cy - 4, inner * 2, 8, { type: "none" }, { stroke: stroke(pith, 1.8), rotation: index * 36 })),
    box("ellipse", cx - radius * 0.1, cy - radius * 0.1, radius * 0.2, radius * 0.2, solid(pith)),
  ];
}

function glass(x: number, y: number, kind: number, color: string): StudioElement[] {
  if (kind % 2 === 0) {
    return [
      box("triangle", x, y + 4, 26, 13, solid(color), { rotation: 180 }),
      box("rect", x + 12, y + 16, 2, 11, solid(darker(color, 0.2))),
      box("ellipse", x + 5, y + 26, 16, 3.5, solid(darker(color, 0.2))),
    ];
  }
  return [
    box("line", x + 12, y - 1, 12, 8, { type: "none" }, { stroke: stroke(darker(color, 0.25), 1.6), rotation: -60 }),
    box("rect", x + 5, y + 4, 16, 25, solid(lighter(color, 0.2)), { radius: 2.5 }),
    box("rect", x + 5, y + 14, 16, 15, solid(color), { radius: 2.5 }),
  ];
}

function cocktailList({ t }: TemplateContext) {
  const page = sizeOf(A5);
  const { width: W, height: H } = page;
  const rust = "#7c2d12";
  const coral = "#ea580c";
  const deep = "#431407";
  const muted = "#7a4a3a";
  const prices = [12, 13, 11, 12, 14, 10];
  const cardX = 28;
  const cardY = 180;
  const cardW = W - cardX * 2;
  return design(t("studio.templates.items.cocktailListMenu"), [rust, coral, deep, "#ffd1c1", "#fff7ed"], [
    pageOf(A5, gradient(165, ["#ffe8db", "#ffd3c2", "#ffc4a8"]), [
      art("diagonalHatch", { primary: "#f6b39a", secondary: "#f6b39a" }, 0, 0, W, H, { opacity: 0.25 }),
      ...citrus(W - 36, 58, 88, "#f59e0b", "#fb923c"),
      ...citrus(26, H - 34, 70, "#f472b6", "#fb7185"),
      text(36, 46, 230, 14, t("studio.tpl.cocktailListMenuKicker"), { font: FONTS.josefin, size: 9, bold: true, color: "#9a3412", spacing: 3, upper: true, valign: "middle", shrink: true }),
      text(36, 64, 240, 92, t("studio.tpl.cocktailListMenuTitle"), { font: FONTS.abril, size: 42, color: rust, lineHeight: 1, valign: "middle", shrink: true }),
      art("dotsDivider", { primary: coral, secondary: rust }, 36, 160, 84, 8),
      shadowed(box("rect", cardX, cardY, cardW, 350, solid("#ffffff"), { radius: 22 }), "lifted", rust),
      ...prices.flatMap((price, index) => {
        const y = cardY + 18 + index * 55;
        return [
          ...glass(cardX + 18, y + 6, index, coral),
          text(cardX + 58, y, cardW - 136, 22, t(`studio.tpl.cocktailListMenuName${index + 1}`), { font: FONTS.abril, size: 15, color: deep, valign: "middle", shrink: true }),
          text(cardX + 58, y + 23, cardW - 136, 16, t(`studio.tpl.cocktailListMenuMix${index + 1}`), { font: FONTS.josefin, size: 9, color: muted, valign: "middle", shrink: true }),
          box("rect", cardX + cardW - 66, y + 8, 46, 22, gradient(90, ["#c2410c", "#9a3412"]), { radius: 11 }),
          text(cardX + cardW - 66, y + 8, 46, 22, String(price), { font: FONTS.josefin, size: 11, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          ...(index < prices.length - 1 ? [rule(cardX + 58, y + 48, cardW - 78, "#f3c6b3", 0.8, "dotted")] : []),
        ];
      }),
      centredText(page, 546, 20, t("studio.tpl.cocktailListMenuNote"), { font: FONTS.josefin, size: 9.5, bold: true, color: rust, spacing: 1, valign: "middle", shrink: true, inset: 96 }),
    ]),
  ]);
}

function bakery({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const { width: W, height: H } = page;
  const red = "#b4472f";
  const cream = "#fbf3e4";
  const brown = "#4a2c1a";
  const muted = "#6e5444";
  const wheat = "#c9a24a";
  const stripes = 10;
  const stripe = W / stripes;
  const awning = 70;
  const cardW = 155;
  const cardH = 196;
  const gapX = 20;
  const left = (W - cardW * 3 - gapX * 2) / 2;
  const rows = [362, 576];
  const prices = [4, 3, 5, 6, 4, 5];
  return design(t("studio.templates.items.bakeryMenu"), [red, cream, brown, wheat, muted], [
    pageOf(A4, radial("#f8eedd", "#ead9bd", { cy: 0.45, radius: 1.1 }), [
      art("halftone", { primary: "#d6bf9a", secondary: "#d6bf9a" }, 0, awning, W, H - awning, { opacity: 0.35 }),
      ...Array.from({ length: stripes }, (_, index) => box("rect", index * stripe, 0, stripe, awning, solid(index % 2 ? cream : red))),
      ...Array.from({ length: stripes }, (_, index) => shadowed(box("ellipse", index * stripe, awning - stripe * 0.3, stripe, stripe * 0.6, solid(index % 2 ? cream : red)), "soft", brown)),
      box("rect", 0, 0, W, 8, solid(brown)),
      shadowed(box("ellipse", W / 2 - 80, 92, 160, 160, solid("#fffaf1")), "lifted", brown),
      box("ellipse", W / 2 - 71, 101, 142, 142, { type: "none" }, { stroke: stroke(red, 1, "dashed") }),
      art("botanicalSprig", { primary: wheat, secondary: darker(wheat, 0.2) }, W / 2 - 12, 110, 24, 44),
      centredText(page, 156, 54, t("studio.tpl.bakeryMenuName"), { font: FONTS.playfair, size: 24, bold: true, color: brown, lineHeight: 1.05, valign: "middle", shrink: true, inset: W / 2 - 62 }),
      box("rect", W / 2 - 18, 216, 36, 1.5, foil("copper", 0)),
      ...[-14, 0, 14].map((offset) => box("star", W / 2 + offset - 4, 222, 8, 8, solid(red))),
      centredText(page, 266, 18, t("studio.tpl.bakeryMenuTagline"), { font: FONTS.josefin, size: 10, bold: true, color: darker(red, 0.25), spacing: 3, upper: true, valign: "middle", shrink: true, inset: 90 }),
      centredText(page, 292, 42, t("studio.tpl.bakeryMenuSection"), { font: FONTS.playfair, size: 28, italic: true, color: brown, valign: "middle", shrink: true, inset: 90 }),
      art("flourishDivider", { primary: red, secondary: wheat }, W / 2 - 70, 336, 140, 16),
      ...prices.flatMap((price, index) => {
        const x = left + (index % 3) * (cardW + gapX);
        const y = rows[Math.floor(index / 3)] ?? 0;
        const [backing, image] = photoSlot(x + cardW / 2 - 46, y + 14, 92, 92, "#f1e2c8", "circle");
        return [
          shadowed(box("rect", x, y, cardW, cardH, solid("#ffffff"), { radius: 14 }), "soft", brown),
          box("ellipse", x + cardW / 2 - 51, y + 9, 102, 102, { type: "none" }, { stroke: stroke(red, 0.9, "dashed") }),
          backing,
          image,
          text(x + 10, y + 116, cardW - 20, 22, t(`studio.tpl.bakeryMenuItem${index + 1}`), { font: FONTS.playfair, size: 13.5, bold: true, color: brown, align: "center", valign: "middle", shrink: true }),
          text(x + 12, y + 139, cardW - 24, 26, t(`studio.tpl.bakeryMenuDesc${index + 1}`), { font: FONTS.josefin, size: 8.5, color: muted, align: "center", lineHeight: 1.35, shrink: true }),
          box("rect", x + cardW / 2 - 26, y + 170, 52, 18, solid(red), { radius: 9 }),
          text(x + cardW / 2 - 26, y + 170, 52, 18, String(price), { font: FONTS.josefin, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
        ];
      }),
      box("rect", 0, H - 54, W, 54, gradient(0, [darker(red, 0.2), red, darker(red, 0.2)])),
      box("rect", 0, H - 56, W, 2, foil("copper", 0)),
      centredText(page, H - 54, 54, t("studio.tpl.bakeryMenuFooter"), { font: FONTS.josefin, size: 10.5, bold: true, color: cream, spacing: 2, upper: true, valign: "middle", shrink: true, inset: 50 }),
    ]),
  ]);
}

function kidsMenu({ t }: TemplateContext) {
  const page = sizeOf(A5);
  const { width: W } = page;
  const blue = "#1d4ed8";
  const navy = "#1e293b";
  const orange = "#9a3412";
  const sun = "#facc15";
  const tiles = ["#fde68a", "#bbf7d0", "#fbcfe8", "#bfdbfe", "#fed7aa", "#ddd6fe"];
  const icons = ["star", "heart", "burst", "hexagon", "cloud", "diamond"] as const;
  const prices = [6, 6, 7, 6, 7, 5];
  const tileW = 168;
  const tileH = 80;
  const gapX = 16;
  const left = (W - tileW * 2 - gapX) / 2;
  const gridX = W - left - 104;
  const gridY = 448;
  const cell = 28;
  return design(t("studio.templates.items.kidsMenu"), [blue, navy, sun, "#f472b6", "#ffffff"], [
    pageOf(A5, gradient(180, ["#dbeafe", "#fefce8"]), [
      art("confetti", { primary: "#60a5fa", secondary: "#f472b6" }, 16, 16, W - 32, 130, { opacity: 0.4 }),
      box("cloud", 18, 34, 92, 50, solid("#ffffff"), { opacity: 0.9 }),
      box("cloud", 96, 118, 60, 32, solid("#ffffff"), { opacity: 0.8 }),
      shadowed(box("burst", W - 104, 20, 84, 84, solid(sun), { points: 12, inner: 0.78 }), "soft", "#f59e0b"),
      box("ellipse", W - 90, 34, 56, 56, radial("#fde047", "#f59e0b")),
      centredText(page, 50, 64, t("studio.tpl.kidsMenuTitle"), { font: FONTS.pacifico, size: 38, color: blue, valign: "middle", shrink: true, inset: 118 }),
      centredText(page, 118, 18, t("studio.tpl.kidsMenuKicker"), { font: FONTS.nunito, size: 10.5, bold: true, color: orange, spacing: 2.5, upper: true, valign: "middle", shrink: true, inset: 110 }),
      ...prices.flatMap((price, index) => {
        const x = left + (index % 2) * (tileW + gapX);
        const y = 156 + Math.floor(index / 2) * 92;
        const tile = tiles[index] ?? "#ffffff";
        return [
          shadowed(box("rect", x, y, tileW, tileH, solid(tile), { radius: 18 }), "soft", navy),
          box("ellipse", x + 10, y + 14, 52, 52, solid("#ffffff")),
          box(icons[index] ?? "star", x + 22, y + 26, 28, 28, solid(darker(tile, 0.35)), icons[index] === "star" ? { points: 5, inner: 0.45 } : icons[index] === "burst" ? { points: 10, inner: 0.7 } : {}),
          text(x + 70, y + 10, tileW - 80, 20, t(`studio.tpl.kidsMenuItem${index + 1}`), { font: FONTS.nunito, size: 12.5, bold: true, color: navy, valign: "middle", shrink: true }),
          text(x + 70, y + 31, tileW - 80, 24, t(`studio.tpl.kidsMenuDesc${index + 1}`), { font: FONTS.nunito, size: 8.5, color: "#334155", lineHeight: 1.25, shrink: true }),
          box("rect", x + 70, y + 57, 34, 16, solid(navy), { radius: 8 }),
          text(x + 70, y + 57, 34, 16, String(price), { font: FONTS.nunito, size: 9.5, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
        ];
      }),
      shadowed(box("rect", left, 436, W - left * 2, 108, solid("#ffffff"), { radius: 18, stroke: stroke(blue, 1.4, "dashed") }), "soft", navy),
      text(left + 20, 448, gridX - left - 36, 84, t("studio.tpl.kidsMenuGame"), { font: FONTS.pacifico, size: 18, color: blue, lineHeight: 1.3, valign: "middle", shrink: true }),
      ...[1, 2].flatMap((step) => [vrule(gridX + 10 + cell * step, gridY, cell * 3, navy, 2.5), rule(gridX + 10, gridY + cell * step, cell * 3, navy, 2.5)]),
      box("line", gridX + 14, gridY + cell / 2 - 4, cell - 8, 8, { type: "none" }, { stroke: stroke("#db2777", 3), rotation: 45 }),
      box("line", gridX + 14, gridY + cell / 2 - 4, cell - 8, 8, { type: "none" }, { stroke: stroke("#db2777", 3), rotation: -45 }),
      box("line", gridX + 14 + cell * 2, gridY + cell * 2.5 - 4, cell - 8, 8, { type: "none" }, { stroke: stroke("#db2777", 3), rotation: 45 }),
      box("line", gridX + 14 + cell * 2, gridY + cell * 2.5 - 4, cell - 8, 8, { type: "none" }, { stroke: stroke("#db2777", 3), rotation: -45 }),
      box("ellipse", gridX + 16 + cell, gridY + cell + 6, cell - 12, cell - 12, { type: "none" }, { stroke: stroke("#ea580c", 3) }),
      box("ellipse", gridX + 16 + cell * 2, gridY + 6, cell - 12, cell - 12, { type: "none" }, { stroke: stroke("#ea580c", 3) }),
      centredText(page, 554, 28, t("studio.tpl.kidsMenuNote"), { font: FONTS.nunito, size: 9.5, bold: true, color: navy, lineHeight: 1.3, valign: "middle", shrink: true, inset: 40 }),
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
  { id: "fineDiningMenu", category: "menus", size: A4, build: fineDining },
  { id: "chalkboardMenu", category: "menus", size: A4, build: chalkboard },
  { id: "cocktailListMenu", category: "menus", size: A5, build: cocktailList },
  { id: "bakeryMenu", category: "menus", size: A4, build: bakery },
  { id: "kidsMenu", category: "menus", size: A5, build: kidsMenu },
];
