import type { StudioElement, StudioFill } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, FONTS, foil, frame, gradient, pageOf, photoSlot, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type ShadowPreset, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const SQUARE = "square" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;
const square = sizeOf(SQUARE);
const S = square.width;

function liftedSlot(elements: StudioElement[], preset: ShadowPreset, color?: string): StudioElement[] {
  const [backing, ...rest] = elements;
  return [shadowed(backing, preset, color), ...rest];
}

function eventPoster({ t }: TemplateContext) {
  const plum = "#2a0b33";
  const wine = "#5b1748";
  const cream = "#fff4e6";
  const peach = "#ffd9a8";
  return design(t("studio.templates.items.eventPoster"), [plum, wine, "#ff7a3d", "#ffd36e", cream], [
    pageOf(A4, gradient(180, [plum, "#3d0f3d", wine]), [
      art("sunburst", { primary: "#ff9a5a", secondary: "#ffd36e" }, 0, 0, W, 560, { opacity: 0.14 }),
      shadowed(box("ellipse", W / 2 - 170, 118, 340, 340, gradient(180, ["#ffe08a", "#ff9a3d", "#e8455a"])), "glow", "#ff9a5a"),
      art("waves", { primary: wine, secondary: wine }, 0, 330, W, 150),
      box("rect", 0, 478, W, H - 478, solid(darker(wine, 0.25))),
      art("halftone", { primary: "#ff7a3d", secondary: "#ffd36e" }, 0, 478, W, H - 478, { opacity: 0.22 }),
      text(40, 44, 300, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 11, bold: true, color: peach, spacing: 3, upper: true, shrink: true }),
      art("dotsDivider", { primary: peach, secondary: peach }, W - 200, 48, 160, 10),
      centredText(page, 470, 196, t("studio.tpl.eventTitle"), { font: FONTS.bebas, size: 118, color: cream, lineHeight: 0.88, valign: "middle", inset: 36, shrink: true, shadow: "deep" }),
      box("rect", W / 2 - 56, 676, 112, 4, foil("gold", 0)),
      centredText(page, 688, 44, t("studio.tpl.eventLead"), { font: FONTS.montserrat, size: 12, color: "#f6dfe8", lineHeight: 1.45, inset: 64, shrink: true }),
      box("rect", 0, H - 96, W, 96, solid(cream)),
      box("rect", 0, H - 96, W, 4, foil("gold", 0)),
      text(40, H - 80, 230, 32, t("studio.tpl.eventDate"), { font: FONTS.bebas, size: 30, color: wine, valign: "middle", shrink: true }),
      text(40, H - 46, 230, 36, t("studio.tpl.eventPlace"), { font: FONTS.montserrat, size: 11, color: "#5b3a4f", lineHeight: 1.3, shrink: true }),
      text(W - 270, H - 76, 150, 56, t("studio.tpl.scanForTickets"), { font: FONTS.montserrat, size: 11, bold: true, color: wine, align: "right", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      qr("https://example.com/event", W - 108, H - 82, 68, wine),
    ]),
  ]);
}

function salePost({ t }: TemplateContext) {
  const red = "#dc2626";
  const deep = "#7f1d1d";
  const yellow = "#facc15";
  return design(t("studio.templates.items.salePost"), [red, deep, yellow, "#ffffff"], [
    pageOf(SQUARE, radial("#ef4444", "#991b1b", { cy: 0.42, radius: 1 }), [
      art("diagonalHatch", { primary: "#ffffff", secondary: yellow }, 0, 0, S, S, { opacity: 0.16 }),
      art("confetti", { primary: yellow, secondary: "#ffffff" }, 60, 176, 440, 150, { opacity: 0.55 }),
      box("rect", 32, 32, S - 64, S - 64, { type: "none" }, { stroke: stroke("#fecaca", 1.5) }),
      shadowed(box("burst", S - 300, 62, 236, 236, solid(yellow), { rotation: 12, points: 18, inner: 0.84 }), "lifted", deep),
      box("ellipse", S - 266, 96, 168, 168, { type: "none" }, { stroke: stroke(deep, 1.5, "dashed"), rotation: 12 }),
      text(S - 262, 128, 160, 104, t("studio.tpl.discount"), { font: FONTS.bebas, size: 62, color: deep, align: "center", valign: "middle", lineHeight: 0.9, rotation: 12, shrink: true }),
      text(72, 116, 400, 26, t("studio.tpl.saleLead"), { font: FONTS.montserrat, size: 20, bold: true, color: yellow, upper: true, spacing: 4, shrink: true }),
      box("rect", 72, 156, 72, 5, solid(yellow)),
      text(64, 300, S - 128, 300, t("studio.tpl.bigSale"), { font: FONTS.bebas, size: 236, color: "#ffffff", lineHeight: 0.84, valign: "middle", upper: true, shrink: true, shadow: "deep" }),
      shadowed(box("rect", 72, 646, 300, 72, solid(yellow), { radius: 36 }), "lifted", deep),
      text(72, 646, 300, 72, t("studio.tpl.shopNow"), { font: FONTS.montserrat, size: 22, bold: true, color: deep, align: "center", valign: "middle", upper: true, spacing: 3, shrink: true }),
      text(400, 656, S - 472, 52, t("studio.tpl.website"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function concert({ t }: TemplateContext) {
  const magenta = "#f0216b";
  const cyan = "#22d3ee";
  const night = "#07051a";
  return design(t("studio.templates.items.concert"), [magenta, cyan, night, "#ffffff"], [
    pageOf(A4, gradient(180, [night, "#160a35", "#2a0f4a"]), [
      art("halftone", { primary: magenta, secondary: cyan }, 0, 0, W, H, { opacity: 0.32 }),
      art("arcRings", { primary: magenta, secondary: cyan }, W / 2 - 210, 64, 420, 420),
      art("arcRings", { primary: cyan, secondary: magenta }, W / 2 - 176, 98, 352, 352, { rotation: 180, opacity: 0.7 }),
      ...liftedSlot(photoSlot(W / 2 - 132, 142, 264, 264, "#2a1450", "circle"), "glow", magenta),
      rule(64, 494, 96, cyan, 1.2),
      rule(W - 160, 494, 96, cyan, 1.2),
      centredText(page, 482, 24, t("studio.tpl.liveInConcert"), { font: FONTS.montserrat, size: 13, bold: true, color: cyan, spacing: 7, upper: true, inset: 172, shrink: true }),
      centredText(page, 514, 150, t("studio.tpl.bandName"), { font: FONTS.bebas, size: 108, color: "#ffffff", lineHeight: 0.86, valign: "middle", inset: 40, shrink: true, shadow: "deep" }),
      box("rect", W / 2 - 80, 676, 160, 3, gradient(0, [magenta, cyan])),
      centredText(page, 694, 26, t("studio.tpl.concertDate"), { font: FONTS.montserrat, size: 17, bold: true, color: "#ffffff", spacing: 2, upper: true, shrink: true }),
      centredText(page, 722, 22, t("studio.tpl.concertPlace"), { font: FONTS.montserrat, size: 13, color: "#d8ccff", shrink: true }),
      art("waves", { primary: magenta, secondary: cyan }, 0, H - 76, W, 76, { opacity: 0.9 }),
      box("rect", W / 2 - 150, 760, 300, 34, solid(night), { radius: 17, stroke: stroke(cyan, 1.2) }),
      text(W / 2 - 140, 760, 280, 34, t("studio.tpl.ticketsAt"), { font: FONTS.montserrat, size: 11, bold: true, color: "#ffffff", spacing: 1.5, upper: true, align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

function workshop({ t }: TemplateContext) {
  const palette = PALETTES.forestCream;
  const forest = palette.accent;
  const gold = palette.accent2;
  const items = ["studio.tpl.workshopPoint1", "studio.tpl.workshopPoint2", "studio.tpl.workshopPoint3"];
  const photoX = 360;
  const bandY = 628;
  return design(t("studio.templates.items.workshop"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      art("topographic", { primary: lighter(forest, 0.55), secondary: gold }, 0, 0, W, bandY, { opacity: 0.32 }),
      box("rect", photoX + 14, 70, W - photoX - 34, 300, { type: "none" }, { radius: 14, stroke: stroke(gold, 1.5) }),
      ...liftedSlot(photoSlot(photoX, 56, W - photoX - 34, 300, palette.soft, "rounded"), "lifted"),
      box("rect", 48, 56, 156, 28, solid(forest), { radius: 14 }),
      text(48, 56, 156, 28, t("studio.tpl.freeWorkshop"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(48, 108, photoX - 72, 186, t("studio.tpl.workshopTitle"), { font: FONTS.playfair, size: 46, bold: true, color: palette.ink, lineHeight: 1.04, valign: "middle", shrink: true }),
      box("rect", 48, 310, 64, 4, foil("gold", 0)),
      text(48, 330, photoX - 72, 72, t("studio.tpl.workshopLead"), { font: FONTS.inter, size: 13, color: palette.muted, lineHeight: 1.5, shrink: true }),
      ...items.flatMap((key, index) => {
        const y = 430 + index * 60;
        return [
          box("ellipse", 48, y, 40, 40, solid(gold)),
          text(48, y, 40, 40, String(index + 1).padStart(2, "0"), { font: FONTS.playfair, size: 15, bold: true, color: palette.ink, align: "center", valign: "middle" }),
          text(104, y, W - 152, 40, t(key), { font: FONTS.inter, size: 14, bold: true, color: palette.ink, valign: "middle", shrink: true }),
          ...(index < items.length - 1 ? [rule(104, y + 50, W - 152, "#e4dcc4", 0.8)] : []),
        ];
      }),
      box("rect", 0, bandY, W, H - bandY, gradient(135, [forest, darker(forest, 0.4)])),
      art("diagonalHatch", { primary: gold, secondary: "#ffffff" }, 0, bandY, W, H - bandY, { opacity: 0.12 }),
      box("rect", 0, bandY, W, 4, foil("gold", 0)),
      text(48, bandY + 48, 320, 34, t("studio.tpl.workshopDate"), { font: FONTS.playfair, size: 22, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(48, bandY + 92, 320, 44, t("studio.tpl.workshopPlace"), { font: FONTS.inter, size: 12, color: "#e7efe2", lineHeight: 1.45, shrink: true }),
      shadowed(box("rect", W - 172, bandY + 36, 124, 124, solid("#ffffff"), { radius: 14 }), "lifted"),
      qr("https://example.com/register", W - 160, bandY + 48, 100, forest),
      text(W - 212, bandY + 168, 164, 18, t("studio.tpl.registerNow"), { font: FONTS.inter, size: 10, bold: true, color: "#f3e3b8", align: "right", upper: true, spacing: 1.2, shrink: true }),
    ]),
  ]);
}

function announcement({ t }: TemplateContext) {
  const palette = PALETTES.ivoryNavy;
  const navy = palette.accent;
  const gold = palette.accent2;
  const header = 300;
  return design(t("studio.templates.items.announcement"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", 0, 0, W, header, gradient(160, [navy, darker(navy, 0.45)])),
      art("diagonalHatch", { primary: "#ffffff", secondary: gold }, 0, 0, W, header, { opacity: 0.1 }),
      art("cornerTriangles", { primary: gold, secondary: lighter(navy, 0.4) }, W - 150, 0, 150, 150, { rotation: 90, opacity: 0.9 }),
      art("halftone", { primary: lighter(navy, 0.55), secondary: gold }, 0, header, W, H - header, { opacity: 0.22 }),
      box("rect", 0, header, W, 5, foil("gold", 0)),
      text(56, 64, 360, 20, t("studio.tpl.orgName"), { font: FONTS.sourceSerif, size: 12, bold: true, color: "#e9d38a", spacing: 3, upper: true, shrink: true }),
      rule(56, 96, 48, gold, 1.5),
      text(56, 116, W - 200, 150, t("studio.tpl.announcementTitle"), { font: FONTS.merriweather, size: 44, bold: true, color: "#ffffff", lineHeight: 1.12, valign: "middle", shrink: true }),
      shadowed(box("ellipse", W - 138, 196, 84, 84, foil("gold", 135)), "lifted"),
      text(W - 138, 196, 84, 84, "!", { font: FONTS.merriweather, size: 44, bold: true, color: palette.ink, align: "center", valign: "middle" }),
      text(56, 348, W - 112, 250, t("studio.tpl.announcementBody"), { font: FONTS.sourceSerif, size: 16, color: palette.ink, lineHeight: 1.6, shrink: true }),
      shadowed(box("rect", 56, 628, W - 112, 84, solid(palette.soft), { radius: 12 }), "soft"),
      box("rect", 56, 628, 6, 84, solid(gold), { radius: 3 }),
      text(84, 640, W - 164, 60, t("studio.tpl.announcementNote"), { font: FONTS.sourceSerif, size: 13, italic: true, color: navy, lineHeight: 1.45, valign: "middle", shrink: true }),
      rule(W - 256, 764, 200, gold, 1),
      text(W - 296, 772, 240, 20, t("studio.tpl.management"), { font: FONTS.sourceSerif, size: 12, bold: true, color: palette.ink, align: "right", spacing: 1, shrink: true }),
      box("rect", 0, H - 14, W, 14, solid(navy)),
    ]),
  ]);
}

function comingSoon({ t }: TemplateContext) {
  const gold = "#d6b25e";
  const night = "#08080c";
  const colours = { primary: gold, secondary: gold };
  return design(t("studio.templates.items.comingSoon"), [gold, night, "#ffffff"], [
    pageOf(SQUARE, radial("#22222e", night, { cy: 0.45, radius: 0.9 }), [
      art("sunburst", { primary: "#3b3b52", secondary: gold }, 0, 0, S, S, { opacity: 0.16 }),
      frame("decoFrame", colours, square),
      art("decoFan", { primary: night, secondary: gold }, S / 2 - 80, 120, 160, 87),
      centredText(square, 236, 28, t("studio.tpl.companyName"), { font: FONTS.josefin, size: 18, bold: true, color: gold, spacing: 10, upper: true, inset: 120, shrink: true }),
      centredText(square, 282, 236, t("studio.tpl.comingSoon"), { font: FONTS.cinzel, size: 104, bold: true, color: "#ffffff", lineHeight: 1.02, upper: true, valign: "middle", inset: 90, shrink: true, shadow: "deep" }),
      art("diamondDivider", colours, S / 2 - 150, 538, 300, 20),
      centredText(square, 576, 66, t("studio.tpl.comingSoonLead"), { font: FONTS.josefin, size: 24, color: "#d9d6cc", lineHeight: 1.35, inset: 150, shrink: true }),
      box("rect", S / 2 - 170, 672, 340, 52, { type: "none" }, { radius: 26, stroke: stroke(gold, 1.5) }),
      text(S / 2 - 160, 672, 320, 52, t("studio.tpl.website"), { font: FONTS.josefin, size: 19, bold: true, color: gold, spacing: 3, align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

function conference({ t }: TemplateContext) {
  const indigo = "#1e1b4b";
  const violet = "#4c1d95";
  const pink = "#f472b6";
  const amber = "#fbbf24";
  const speakers = [0, 1, 2];
  const column = (W - 96) / 3;
  return design(t("studio.templates.items.conference"), [indigo, violet, pink, amber, "#ffffff"], [
    pageOf(A4, gradient(160, ["#0d0b2a", indigo, violet]), [
      art("triangleTiles", { primary: "#ffffff", secondary: pink }, 0, 0, W, H, { opacity: 0.05 }),
      art("blob", { primary: pink, secondary: violet }, W - 250, -90, 340, 340, { opacity: 0.55 }),
      text(30, 36, W - 40, 200, "2027", { font: FONTS.montserrat, size: 196, bold: true, color: "#ffffff", opacity: 0.07, valign: "middle" }),
      box("rect", 48, 72, 220, 28, solid(pink), { radius: 14 }),
      text(48, 72, 220, 28, t("studio.tpl.conferenceYear"), { font: FONTS.montserrat, size: 10, bold: true, color: indigo, spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      text(48, 132, W - 96, 200, t("studio.tpl.conferenceTitle"), { font: FONTS.montserrat, size: 58, bold: true, color: "#ffffff", lineHeight: 1.0, valign: "bottom", shrink: true }),
      box("rect", 48, 352, 96, 5, gradient(0, [pink, amber])),
      text(48, 376, W - 150, 64, t("studio.tpl.conferenceLead"), { font: FONTS.inter, size: 14, color: "#ddd6fe", lineHeight: 1.5, shrink: true }),
      text(48, 466, 160, 18, t("studio.tpl.speakers"), { font: FONTS.montserrat, size: 11, bold: true, color: amber, spacing: 3, upper: true, shrink: true }),
      rule(208, 475, W - 256, "#6d5bd0", 0.8),
      ...speakers.flatMap((index) => {
        const centre = 48 + column * index + column / 2;
        return [
          box("ellipse", centre - 62, 498, 124, 124, { type: "none" }, { stroke: stroke(pink, 1.5) }),
          ...liftedSlot(photoSlot(centre - 54, 506, 108, 108, "#3b2a7a", "circle"), "lifted"),
          text(centre - column / 2 + 6, 632, column - 12, 20, t("studio.tpl.speakerName"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", align: "center", shrink: true }),
          text(centre - column / 2 + 6, 652, column - 12, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 10, color: "#c4b5fd", align: "center", shrink: true }),
        ];
      }),
      shadowed(box("rect", 48, 694, W - 96, 116, solid("#ffffff"), { radius: 18 }), "lifted", "#000000"),
      box("rect", 48, 694, 8, 116, gradient(90, [pink, amber]), { radius: 4 }),
      text(76, 714, 300, 30, t("studio.tpl.conferenceDate"), { font: FONTS.montserrat, size: 20, bold: true, color: indigo, valign: "middle", shrink: true }),
      text(76, 750, 300, 44, t("studio.tpl.conferencePlace"), { font: FONTS.inter, size: 12, color: "#4b4a6b", lineHeight: 1.4, shrink: true }),
      qr("https://example.com/conference", W - 150, 708, 88, indigo),
    ]),
  ]);
}

function fitness({ t }: TemplateContext) {
  const lime = "#a3e635";
  const ink = "#0a0a0a";
  return design(t("studio.templates.items.fitness"), [lime, ink, "#ffffff"], [
    pageOf(A4, solid(ink), [
      ...photoSlot(0, 0, W, 540, "#262626"),
      box("rect", -80, 486, W + 160, 160, solid(ink), { rotation: -6 }),
      art("diagonalHatch", { primary: lime, secondary: "#ffffff" }, 0, 560, W, H - 616, { opacity: 0.1 }),
      box("rect", -80, 478, W + 160, 6, solid(lime), { rotation: -6 }),
      shadowed(box("parallelogram", 36, 450, 236, 54, solid(lime), { rotation: -6 }), "long", "#000000"),
      text(56, 450, 196, 54, t("studio.tpl.joinToday"), { font: FONTS.oswald, size: 22, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 2, rotation: -6, shrink: true }),
      text(40, 560, W - 80, 160, t("studio.tpl.fitnessTitle"), { font: FONTS.oswald, size: 76, bold: true, color: "#ffffff", lineHeight: 0.94, upper: true, valign: "middle", shrink: true }),
      box("rect", 40, 728, 72, 5, solid(lime)),
      text(40, 742, W - 80, 40, t("studio.tpl.fitnessLead"), { font: FONTS.inter, size: 14, color: "#d4d4d4", lineHeight: 1.45, shrink: true }),
      box("rect", 0, H - 56, W, 56, solid(lime)),
      text(40, H - 56, W / 2 - 50, 56, t("studio.tpl.phone"), { font: FONTS.oswald, size: 17, bold: true, color: ink, valign: "middle", spacing: 1, shrink: true }),
      text(W / 2 + 10, H - 56, W / 2 - 50, 56, t("studio.tpl.website"), { font: FONTS.oswald, size: 17, bold: true, color: ink, align: "right", valign: "middle", spacing: 1, shrink: true }),
    ]),
  ]);
}

function semicircle(x: number, y: number, width: number, fill: StudioFill): StudioElement {
  return { ...box("rect", x, y, width, width / 2, fill), corners: [width / 2, width / 2, 0, 0] as [number, number, number, number] };
}

function festivalLineup({ t }: TemplateContext) {
  const cream = "#f7ecd8";
  const brown = "#3b1d12";
  const teal = "#1f6f6b";
  const pink = "#d9435b";
  const orange = "#ee7a2f";
  const mustard = "#f2b443";
  const display = FONTS.abril;
  const body = FONTS.montserrat;
  const key = (name: string) => t(`studio.tpl.festivalLineup${name}`);
  const base = 356;
  const bands = [teal, pink, orange, mustard];
  const sparkles: [number, number, number][] = [
    [54, 168, 18],
    [86, 132, 10],
    [W - 74, 300, 14],
  ];
  return design(t("studio.templates.items.festivalLineup"), [brown, teal, pink, orange, mustard, cream], [
    pageOf(A4, solid(cream), [
      art("halftone", { primary: mustard, secondary: orange }, 0, 0, W, H, { opacity: 0.14 }),
      ...bands.map((colour, index) => {
        const radius = 262 - index * 46;
        return semicircle(W / 2 - radius, base - radius, radius * 2, solid(colour));
      }),
      shadowed(semicircle(W / 2 - 78, base - 78, 156, gradient(180, ["#fff6dc", "#ffd27a"])), "glow", "#ffffff"),
      art("sunburst", { primary: "#fff6dc", secondary: mustard }, W / 2 - 78, base - 78, 156, 78, { opacity: 0.35 }),
      box("rect", 40, base, W - 80, 3, solid(brown)),
      ...sparkles.map(([x, y, side]) => box("star", x, y, side, side, solid(brown), { points: 4, inner: 0.32 })),
      text(40, 36, 260, 18, t("studio.tpl.orgName"), { font: body, size: 10, bold: true, color: brown, spacing: 3, upper: true, valign: "middle", shrink: true }),
      text(W - 240, 36, 200, 18, key("Edition"), { font: body, size: 10, bold: true, color: brown, spacing: 3, upper: true, align: "right", valign: "middle", shrink: true }),
      shadowed(box("burst", W - 158, 108, 118, 118, solid("#b8324a"), { points: 18, inner: 0.84, rotation: 12 }), "lifted", brown),
      text(W - 148, 136, 98, 62, key("Badge"), { font: body, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, lineHeight: 1.05, rotation: 12, shrink: true }),
      centredText(page, 376, 136, key("Title"), { font: display, size: 62, color: brown, lineHeight: 1.0, valign: "middle", inset: 40, shrink: true }),
      centredText(page, 520, 22, key("Dates"), { font: body, size: 12, bold: true, color: teal, spacing: 2.5, upper: true, valign: "middle", inset: 48, shrink: true }),
      art("dotsDivider", { primary: pink, secondary: orange }, W / 2 - 60, 556, 120, 10),
      centredText(page, 580, 68, key("Headliners"), { font: body, size: 21, bold: true, color: brown, upper: true, lineHeight: 1.2, valign: "middle", inset: 36, shrink: true }),
      centredText(page, 656, 40, key("Acts"), { font: body, size: 13, bold: true, color: "#a92f45", lineHeight: 1.35, valign: "middle", inset: 64, shrink: true }),
      centredText(page, 702, 18, key("More"), { font: body, size: 11, color: "#6b4a3a", valign: "middle", inset: 64, shrink: true }),
      box("rect", 0, H - 112, W, 112, gradient(90, [brown, "#5a2a18"])),
      art("halftone", { primary: orange, secondary: mustard }, W / 2, H - 112, W / 2, 112, { opacity: 0.25 }),
      box("rect", 0, H - 112, W, 4, gradient(0, [teal, pink, orange, mustard])),
      text(40, H - 92, 330, 30, key("Cta"), { font: display, size: 24, color: cream, valign: "middle", shrink: true }),
      text(40, H - 58, 330, 18, t("studio.tpl.website"), { font: body, size: 12, bold: true, color: mustard, spacing: 1, valign: "middle", shrink: true }),
      text(40, H - 36, 330, 16, key("EarlyBird"), { font: body, size: 10, color: "#f3dcc4", valign: "middle", shrink: true }),
      shadowed(box("rect", W - 124, H - 100, 84, 84, solid("#ffffff"), { radius: 10 }), "lifted", "#000000"),
      qr("https://example.com/festival", W - 116, H - 92, 68, brown),
    ]),
  ]);
}

function exhibitionPoster({ t }: TemplateContext) {
  const paper = "#f2efe9";
  const ink = "#151515";
  const red = "#cf3f27";
  const grey = "#5a5a5a";
  const display = FONTS.cormorant;
  const body = FONTS.inter;
  const key = (name: string) => t(`studio.tpl.exhibitionPoster${name}`);
  const column = (W - 80) / 3;
  const facts = [
    ["DatesLabel", "Dates"],
    ["VenueLabel", "Venue"],
    ["HoursLabel", "Hours"],
  ];
  return design(t("studio.templates.items.exhibitionPoster"), [ink, red, paper, grey], [
    pageOf(A4, solid(paper), [
      box("ellipse", 232, 104, 420, 420, gradient(160, ["#db5236", "#b8321d"])),
      box("ellipse", 292, 112, 56, 56, solid(ink)),
      text(40, 40, 200, 20, t("studio.tpl.orgName"), { font: body, size: 9.5, bold: true, color: ink, spacing: 2, upper: true, valign: "middle", shrink: true }),
      text(W / 2 - 90, 40, 180, 20, key("Kicker"), { font: body, size: 9.5, bold: true, color: ink, spacing: 4, upper: true, align: "center", valign: "middle", shrink: true }),
      text(W - 200, 40, 160, 20, "2027", { font: body, size: 9.5, bold: true, color: ink, spacing: 2, align: "right", valign: "middle" }),
      rule(40, 72, W - 80, ink, 0.8),
      ...liftedSlot(photoSlot(72, 140, 250, 330, "#d8d2c6"), "lifted"),
      rule(72, 492, 24, ink, 1),
      text(104, 482, 230, 20, key("Caption"), { font: display, size: 13, italic: true, color: grey, valign: "middle", shrink: true }),
      text(40, 540, W - 80, 160, key("Title"), { font: display, size: 96, bold: true, color: ink, lineHeight: 0.92, valign: "bottom", shrink: true }),
      text(40, 708, W - 80, 24, key("Subtitle"), { font: display, size: 18, italic: true, color: ink, valign: "middle", shrink: true }),
      rule(40, 748, W - 80, ink, 0.8),
      ...facts.flatMap(([label, value], index) => {
        const x = 40 + index * column;
        return [
          ...(index ? [vrule(x, 760, 52, "#c9c3b8", 0.8)] : []),
          text(x + (index ? 14 : 0), 762, column - 20, 14, key(label), { font: body, size: 8.5, bold: true, color: grey, spacing: 1.5, upper: true, valign: "middle", shrink: true }),
          text(x + (index ? 14 : 0), 780, column - 20, 32, key(value), { font: body, size: 10.5, bold: true, color: ink, lineHeight: 1.3, shrink: true }),
        ];
      }),
    ]),
  ]);
}

function productLaunch({ t }: TemplateContext) {
  const ink = "#0f172a";
  const muted = "#475569";
  const coral = "#ff5a36";
  const coralInk = "#b93a1e";
  const display = FONTS.poppins;
  const body = FONTS.inter;
  const key = (name: string) => t(`studio.tpl.productLaunch${name}`);
  const column = (W - 80) / 3;
  const specs = [1, 2, 3];
  return design(t("studio.templates.items.productLaunch"), [ink, coral, "#f1f5f9", "#ffffff"], [
    pageOf(A4, radial("#ffffff", "#e3e8ef", { cy: 0.48, radius: 0.95 }), [
      art("arcRings", { primary: "#cbd5e1", secondary: coral }, W / 2 - 236, 230, 472, 472, { opacity: 0.55 }),
      box("ellipse", W / 2 - 200, 266, 400, 400, radial("#ffd9cc", "#e9edf3"), { opacity: 0.9 }),
      box("ellipse", W / 2 - 130, 606, 260, 22, solid(ink), { opacity: 0.1 }),
      ...liftedSlot(photoSlot(W / 2 - 140, 312, 280, 280, "#f1f5f9", "circle"), "lifted"),
      shadowed(box("ellipse", W / 2 + 92, 318, 56, 56, solid(coral)), "soft", coralInk),
      box("star", W / 2 + 106, 332, 28, 28, solid("#ffffff"), { points: 4, inner: 0.32 }),
      text(40, 40, 260, 24, t("studio.tpl.companyName"), { font: display, size: 13, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", W - 132, 40, 92, 24, solid(ink), { radius: 12 }),
      text(W - 128, 40, 84, 24, key("Badge"), { font: body, size: 9.5, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      centredText(page, 100, 20, key("Kicker"), { font: body, size: 12, bold: true, color: coralInk, spacing: 5, upper: true, valign: "middle", shrink: true }),
      centredText(page, 124, 92, key("Name"), { font: display, size: 78, bold: true, color: ink, lineHeight: 1, valign: "middle", inset: 40, shrink: true }),
      centredText(page, 220, 44, key("Tagline"), { font: body, size: 13, color: muted, lineHeight: 1.45, inset: 84, shrink: true }),
      ...specs.flatMap((spec, index) => {
        const x = 40 + index * column;
        return [
          ...(index ? [vrule(x, 664, 60, "#cbd5e1", 1)] : []),
          box("diamond", x + column / 2 - 5, 650, 10, 10, solid(coral)),
          text(x + 8, 668, column - 16, 36, key(`Spec${spec}Value`), { font: display, size: 28, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
          text(x + 8, 706, column - 16, 16, key(`Spec${spec}Label`), { font: body, size: 9.5, bold: true, color: muted, align: "center", upper: true, spacing: 1.2, valign: "middle", shrink: true }),
        ];
      }),
      box("rect", 0, H - 96, W, 96, gradient(90, [ink, "#1e293b"])),
      box("rect", 0, H - 96, W, 3, solid(coral)),
      text(40, H - 80, 260, 16, key("AvailableLabel"), { font: body, size: 9.5, bold: true, color: "#ffb4a2", upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(40, H - 62, 260, 30, key("LaunchDate"), { font: display, size: 22, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 30, 260, 16, t("studio.tpl.website"), { font: body, size: 10, color: "#cbd5e1", valign: "middle", shrink: true }),
      shadowed(box("rect", W - 236, H - 72, 196, 48, solid(coral), { radius: 24 }), "lifted", "#000000"),
      text(W - 226, H - 72, 176, 48, key("Cta"), { font: display, size: 13, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
    ]),
  ]);
}

function summitPoster({ t }: TemplateContext) {
  const navy = "#0a1931";
  const navy2 = "#132c57";
  const amber = "#fbbf24";
  const sky = "#7dd3fc";
  const card = "#16346a";
  const display = FONTS.oswald;
  const body = FONTS.raleway;
  const key = (name: string) => t(`studio.tpl.summitPoster${name}`);
  const column = (W - 80) / 3;
  const half = (W - 80 - 12) / 2;
  const stats = [1, 2, 3];
  const tracks = [1, 2, 3, 4];
  const cardX = W - 196;
  return design(t("studio.templates.items.summitPoster"), [navy, navy2, amber, sky, "#ffffff"], [
    pageOf(A4, gradient(165, [navy, navy2]), [
      art("honeycomb", { primary: "#24447e", secondary: sky }, 0, 0, W, 380, { opacity: 0.3 }),
      box("ellipse", W - 280, -140, 400, 400, radial("#1d4ed8", navy2), { opacity: 0.45 }),
      box("rect", 40, 52, 208, 26, solid(amber), { radius: 13 }),
      text(48, 52, 192, 26, key("Kicker"), { font: body, size: 9.5, bold: true, color: navy, spacing: 2, upper: true, align: "center", valign: "middle", shrink: true }),
      text(40, 96, cardX - 64, 214, key("Title"), { font: display, size: 66, bold: true, color: "#ffffff", lineHeight: 1.0, upper: true, valign: "bottom", shrink: true }),
      shadowed(box("rect", cardX, 96, 156, 214, foil("gold", 150), { radius: 16 }), "lifted", "#000000"),
      text(cardX + 8, 114, 140, 24, key("Month"), { font: display, size: 17, bold: true, color: navy, align: "center", upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(cardX + 8, 142, 140, 112, "14\n15", { font: display, size: 50, bold: true, color: navy, align: "center", valign: "middle", lineHeight: 1.0 }),
      rule(cardX + 48, 264, 60, navy, 1.2),
      text(cardX + 8, 274, 140, 24, "2027", { font: display, size: 17, bold: true, color: navy, align: "center", spacing: 4, valign: "middle" }),
      text(40, 334, W - 80, 48, key("Lead"), { font: body, size: 13, color: "#cbd5e1", lineHeight: 1.5, shrink: true }),
      ...stats.flatMap((stat, index) => {
        const x = 40 + index * column;
        return [
          ...(index ? [vrule(x, 432, 56, "#2d4a80", 1)] : []),
          text(x + (index ? 16 : 0), 402, column - 24, 50, key(`Stat${stat}Value`), { font: display, size: 42, bold: true, color: amber, valign: "middle", shrink: true }),
          text(x + (index ? 16 : 0), 454, column - 24, 18, key(`Stat${stat}Label`), { font: body, size: 10, bold: true, color: "#bfdbfe", upper: true, spacing: 1.5, valign: "middle", shrink: true }),
        ];
      }),
      text(40, 502, 220, 18, key("TracksHeading"), { font: body, size: 10.5, bold: true, color: amber, spacing: 3, upper: true, valign: "middle", shrink: true }),
      rule(252, 511, W - 292, "#2d4a80", 0.8),
      ...tracks.flatMap((track, index) => {
        const x = 40 + (index % 2) * (half + 12);
        const y = 532 + Math.floor(index / 2) * 64;
        return [
          box("rect", x, y, half, 52, solid(card), { radius: 12, stroke: stroke("#2b4c8a", 1) }),
          box("rect", x, y + 14, 3, 24, solid(sky), { radius: 1.5 }),
          text(x + 16, y, 40, 52, String(track).padStart(2, "0"), { font: display, size: 18, bold: true, color: sky, valign: "middle" }),
          text(x + 56, y, half - 70, 52, key(`Track${track}`), { font: body, size: 13, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
        ];
      }),
      shadowed(box("rect", 40, H - 180, W - 80, 136, solid("#ffffff"), { radius: 18 }), "lifted", "#000000"),
      box("rect", 40, H - 180, 8, 136, gradient(90, [amber, "#f59e0b"]), { radius: 4 }),
      text(72, H - 160, 300, 32, t("studio.tpl.conferenceDate"), { font: display, size: 24, bold: true, color: navy, upper: true, valign: "middle", shrink: true }),
      text(72, H - 122, 300, 40, t("studio.tpl.conferencePlace"), { font: body, size: 12, color: "#475569", lineHeight: 1.4, shrink: true }),
      text(72, H - 78, 300, 18, t("studio.tpl.website"), { font: body, size: 11, bold: true, color: "#1d4ed8", valign: "middle", shrink: true }),
      qr("https://example.com/summit", W - 150, H - 166, 90, navy),
      text(W - 170, H - 72, 130, 16, t("studio.tpl.registerNow"), { font: body, size: 8.5, bold: true, color: navy, align: "center", upper: true, spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function mantraPoster({ t }: TemplateContext) {
  const night = "#12163a";
  const indigo = "#2b2a6e";
  const violet = "#5b3f8f";
  const gold = "#f6c66b";
  const coral = "#f07167";
  const display = FONTS.playfair;
  const body = FONTS.raleway;
  const key = (name: string) => t(`studio.tpl.mantraPoster${name}`);
  const stars: [number, number, number][] = [
    [64, 84, 12],
    [132, 210, 7],
    [W - 96, 128, 14],
    [W - 150, 260, 8],
    [96, 430, 9],
    [W - 80, 404, 10],
    [W / 2 + 160, 60, 6],
  ];
  return design(t("studio.templates.items.mantraPoster"), [night, indigo, violet, gold, coral], [
    pageOf(A4, gradient(180, [night, indigo, violet]), [
      ...stars.map(([x, y, side]) => box("star", x, y, side, side, solid("#ffffff"), { points: 4, inner: 0.3, opacity: 0.85 })),
      box("rect", 24, 24, W - 48, H - 48, { type: "none" }, { stroke: stroke("#ffffff", 0.8), opacity: 0.35 }),
      shadowed(box("ellipse", W / 2 - 120, 452, 240, 240, gradient(180, [gold, coral])), "glow", "#ffb38a"),
      box("triangle", -140, 520, 540, 340, gradient(180, ["#4a3d8f", indigo])),
      box("triangle", 200, 486, 540, 370, gradient(180, ["#3d3480", "#231f5c"])),
      box("triangle", -80, 616, 440, 240, solid("#1d1b4f")),
      box("triangle", 250, 640, 460, 220, solid("#16153f")),
      box("rect", 0, 790, W, H - 790, solid("#121138")),
      art("waves", { primary: "#2b2a6e", secondary: "#1d1b4f" }, 0, 760, W, 50, { opacity: 0.5 }),
      centredText(page, 76, 18, key("Kicker"), { font: body, size: 11, bold: true, color: gold, spacing: 6, upper: true, valign: "middle", shrink: true }),
      box("rect", W / 2 - 20, 104, 40, 2, solid(gold)),
      centredText(page, 118, 90, "“", { font: display, size: 130, color: gold, valign: "top", opacity: 0.9 }),
      centredText(page, 196, 196, key("Quote"), { font: display, size: 42, italic: true, color: "#ffffff", lineHeight: 1.2, valign: "middle", inset: 60, shrink: true }),
      centredText(page, 404, 20, key("Author"), { font: body, size: 12, bold: true, color: "#e9d5ff", spacing: 4, upper: true, valign: "middle", shrink: true }),
      centredText(page, H - 48, 18, t("studio.tpl.website"), { font: body, size: 11, color: "#c7c2f0", spacing: 2, valign: "middle", shrink: true }),
    ]),
  ]);
}

export const POSTER_TEMPLATES: StudioTemplate[] = [
  { id: "eventPoster", category: "posters", size: A4, build: eventPoster },
  { id: "salePost", category: "social", size: SQUARE, build: salePost },
  { id: "concert", category: "posters", size: A4, build: concert },
  { id: "workshop", category: "posters", size: A4, build: workshop },
  { id: "announcement", category: "posters", size: A4, build: announcement },
  { id: "comingSoon", category: "social", size: SQUARE, build: comingSoon },
  { id: "conference", category: "posters", size: A4, build: conference },
  { id: "fitness", category: "posters", size: A4, build: fitness },
  { id: "festivalLineup", category: "posters", size: A4, build: festivalLineup },
  { id: "exhibitionPoster", category: "posters", size: A4, build: exhibitionPoster },
  { id: "productLaunch", category: "posters", size: A4, build: productLaunch },
  { id: "summitPoster", category: "posters", size: A4, build: summitPoster },
  { id: "mantraPoster", category: "posters", size: A4, build: mantraPoster },
];
