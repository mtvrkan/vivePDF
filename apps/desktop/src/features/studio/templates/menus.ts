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

export const MENU_TEMPLATES: StudioTemplate[] = [
  { id: "restaurantMenu", category: "menus", size: A4, build: restaurant },
  { id: "cafeMenu", category: "menus", size: A4, build: cafe },
  { id: "weddingMenu", category: "menus", size: TALL, build: weddingMenu },
  { id: "burgerMenu", category: "menus", size: A4, build: burgerMenu },
  { id: "cocktailMenu", category: "menus", size: TALL, build: cocktailMenu },
  { id: "dessertMenu", category: "menus", size: A5, build: dessertMenu },
];
