import type { StudioElement } from "@/types/studio";
import { darker } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, gradient, pageOf, photo, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type ShadowPreset, type StudioTemplate, type TemplateContext, type TextOptions } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const A4 = "a4" as const;
const A5 = "a5" as const;
const LANDSCAPE = "a4Landscape" as const;
const PAGE = sizeOf(A4);
const W = PAGE.width;
const H = PAGE.height;
const NONE = { type: "none" } as const;

function key(name: string): string {
  return `studio.tpl.flyers.${name}`;
}

function pill(x: number, y: number, width: number, height: number, fill: string, value: string, options: TextOptions): StudioElement[] {
  return [
    box("rect", x, y, width, height, solid(fill), { radius: height / 2 }),
    text(x + 6, y, width - 12, height, value, { size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true, ...options }),
  ];
}

function photoCard(x: number, y: number, width: number, height: number, backing: string, mask: "none" | "rounded" | "circle" = "rounded", preset: ShadowPreset = "soft", tint?: string): StudioElement[] {
  const shape = mask === "circle" ? box("ellipse", x, y, width, height, solid(backing)) : box("rect", x, y, width, height, solid(backing), { radius: mask === "rounded" ? 12 : 0 });
  return [shadowed(shape, preset, tint), photo(x, y, width, height, mask)];
}

function qrCard(url: string, x: number, y: number, side: number, colour: string, preset: ShadowPreset = "soft"): StudioElement[] {
  const pad = Math.round(side * 0.09);
  return [shadowed(box("rect", x, y, side, side, solid("#ffffff"), { radius: 10 }), preset), qr(url, x + pad, y + pad, side - pad * 2, colour)];
}

function realEstateFlyer({ t }: TemplateContext) {
  const teal = "#0f3d3e";
  const deep = "#082627";
  const gold = "#c8a35a";
  const goldInk = "#8a6a24";
  const display = FONTS.playfair;
  const body = FONTS.montserrat;
  const thumb = (W - 64 - 24) / 3;
  const tile = (W - 64) / 4;
  const card = { x: 56, y: 332, width: W - 112, height: 136 };
  const features = [
    ["bedsValue", "bedsLabel"],
    ["bathsValue", "bathsLabel"],
    ["areaValue", "areaLabel"],
    ["garageValue", "garageLabel"],
  ];
  return design(t("studio.templates.items.realEstateFlyer"), [teal, gold, "#fbf8f3", deep], [
    pageOf(A4, radial("#fdfbf7", "#efe8dc", { cy: 0.35, radius: 1 }), [
      ...photoCard(32, 32, W - 64, 360, "#d6d3cd", "rounded", "lifted"),
      shadowed(box("rect", 52, 52, 124, 30, foil("gold", 0), { radius: 15 }), "soft"),
      text(58, 52, 112, 30, t(key("forSale")), { font: body, size: 11, bold: true, color: deep, align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#ffffff"), { radius: 16 }), "lifted"),
      box("rect", card.x + 28, card.y + 22, 36, 3, foil("gold", 0), { radius: 1.5 }),
      text(card.x + 28, card.y + 30, 300, 18, t(key("justListed")), { font: body, size: 9.5, bold: true, color: goldInk, upper: true, spacing: 2.5, valign: "middle", shrink: true }),
      text(card.x + 28, card.y + 50, 300, 58, t(key("homeTitle")), { font: display, size: 23, bold: true, color: teal, lineHeight: 1.12, valign: "middle", shrink: true }),
      text(card.x + 28, card.y + 108, 300, 18, t(key("homeAddress")), { font: body, size: 10.5, color: "#57534e", valign: "middle", shrink: true }),
      vrule(card.x + 344, card.y + 28, card.height - 56, "#e7e5e4", 1),
      text(card.x + 356, card.y + 38, card.width - 380, 16, t(key("askingPrice")), { font: body, size: 8.5, bold: true, color: "#78716c", align: "right", upper: true, spacing: 1.5, shrink: true }),
      text(card.x + 356, card.y + 58, card.width - 380, 46, t(key("homePrice")), { font: display, size: 30, bold: true, color: teal, align: "right", valign: "middle", shrink: true }),
      ...[0, 1, 2].flatMap((index) => photoCard(32 + index * (thumb + 12), 492, thumb, 108, "#e7e5e4", "rounded", "soft")),
      shadowed(box("rect", 32, 620, W - 64, 70, solid("#ffffff"), { radius: 14 }), "soft"),
      ...features.flatMap(([value, label], index) => [
        text(32 + index * tile + 8, 630, tile - 16, 30, t(key(value)), { font: body, size: 18, bold: true, color: teal, align: "center", valign: "middle", shrink: true }),
        text(32 + index * tile + 8, 662, tile - 16, 16, t(key(label)), { font: body, size: 8.5, bold: true, color: "#78716c", align: "center", upper: true, spacing: 1, shrink: true }),
      ]),
      ...[1, 2, 3].map((index) => vrule(32 + index * tile, 634, 42, "#e7e5e4", 1)),
      text(40, 698, W - 80, 20, t(key("homeHighlights")), { font: display, size: 11.5, italic: true, color: "#57534e", align: "center", valign: "middle", shrink: true }),
      box("rect", 0, H - 116, W, 116, gradient(120, [teal, deep])),
      art("topographic", { primary: "#2c6b6c", secondary: gold }, 0, H - 116, W, 116, { opacity: 0.3 }),
      box("rect", 0, H - 116, W, 3, foil("gold", 0)),
      box("ellipse", 30, H - 96, 80, 80, foil("gold", 135)),
      ...photoCard(34, H - 92, 72, 72, "#1d5c5d", "circle", "soft"),
      text(128, H - 94, 200, 22, t(key("agentName")), { font: display, size: 16, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(128, H - 72, 200, 16, t(key("agentRole")), { font: body, size: 9, color: "#e3c98d", valign: "middle", shrink: true }),
      text(128, H - 52, 200, 18, t("studio.tpl.phone"), { font: body, size: 11.5, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(128, H - 34, 200, 16, t("studio.tpl.email"), { font: body, size: 10, color: "#cfe0df", valign: "middle", shrink: true }),
      text(W - 248, H - 80, 124, 44, t(key("scanTour")), { font: body, size: 9.5, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/listing", W - 112, H - 98, 80, teal),
    ]),
  ]);
}

function hiringFlyer({ t }: TemplateContext) {
  const indigo = "#4338ca";
  const deep = "#1e1b4b";
  const night = "#2a2570";
  const orange = "#ea580c";
  const display = FONTS.bebas;
  const body = FONTS.poppins;
  const hero = 392;
  const roles = [
    ["role1", "role1Meta"],
    ["role2", "role2Meta"],
    ["role3", "role3Meta"],
  ];
  const perks = ["perk1", "perk2", "perk3", "perk4"];
  const chip = (W - 80 - 30) / 4;
  return design(t("studio.templates.items.hiringFlyer"), [indigo, orange, deep, "#f7f6ff"], [
    pageOf(A4, solid("#f7f6ff"), [
      box("rect", 0, 0, W, hero, gradient(155, [night, deep])),
      art("halftone", { primary: "#6366f1", secondary: "#818cf8" }, 0, 0, W, hero, { opacity: 0.4 }),
      box("ellipse", W - 250, -150, 420, 420, radial("#6d5dfc", night), { opacity: 0.55 }),
      art("arcRings", { primary: "#ffffff", secondary: "#fb923c" }, W - 226, -54, 250, 250, { opacity: 0.5 }),
      shadowed(box("rect", 40, 44, 32, 32, solid(orange), { radius: 9 }), "soft"),
      box("diamond", 48, 52, 16, 16, solid("#ffffff")),
      text(84, 44, 240, 32, t("studio.tpl.companyName"), { font: body, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, 116, 320, 28, t(key("joinTeam")), { font: body, size: 14, bold: true, color: "#fdba74", upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(40, 146, 340, 226, t(key("hiringTitle")), { font: display, size: 124, color: "#ffffff", lineHeight: 0.88, valign: "bottom", shrink: true, shadow: "subtle" }),
      shadowed(box("speech", W - 206, 248, 166, 106, solid(orange)), "lifted"),
      text(W - 196, 256, 146, 66, t(key("hiringBubble")), { font: body, size: 20, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
      text(40, hero + 16, W - 80, 42, t(key("hiringLead")), { font: body, size: 12, color: "#4b5563", lineHeight: 1.5, valign: "middle", shrink: true }),
      ...roles.flatMap(([title, meta], index) => {
        const y = hero + 70 + index * 72;
        return [
          shadowed(box("rect", 40, y, W - 80, 60, solid("#ffffff"), { radius: 14 }), "soft", indigo),
          box("rect", 56, y + 15, 4, 30, solid(orange), { radius: 2 }),
          text(74, y + 10, 330, 22, t(key(title)), { font: body, size: 13.5, bold: true, color: deep, valign: "middle", shrink: true }),
          text(74, y + 32, 330, 18, t(key(meta)), { font: body, size: 9.5, color: "#6b7280", valign: "middle", shrink: true }),
          ...pill(W - 150, y + 16, 94, 28, indigo, t(key("apply")), { font: body }),
        ];
      }),
      text(40, 680, 300, 18, t(key("weOffer")), { font: body, size: 11, bold: true, color: indigo, upper: true, spacing: 2, valign: "middle", shrink: true }),
      ...perks.flatMap((perk, index) => [
        box("rect", 40 + index * (chip + 10), 704, chip, 28, solid("#e8e9ff"), { radius: 14 }),
        text(46 + index * (chip + 10), 704, chip - 12, 28, t(key(perk)), { font: body, size: 9.5, bold: true, color: deep, align: "center", valign: "middle", shrink: true }),
      ]),
      box("rect", 0, H - 88, W, 88, gradient(0, [deep, night])),
      art("halftone", { primary: "#4f46e5", secondary: "#6366f1" }, W / 2, H - 88, W / 2, 88, { opacity: 0.3 }),
      box("rect", 0, H - 88, W, 3, solid(orange)),
      text(40, H - 70, 300, 16, t(key("sendCv")), { font: body, size: 9.5, color: "#c7d2fe", valign: "middle", shrink: true }),
      text(40, H - 52, 300, 26, t("studio.tpl.email"), { font: body, size: 18, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 24, 300, 14, t("studio.tpl.website"), { font: body, size: 9, color: "#a5b4fc", valign: "middle", shrink: true }),
      text(W - 250, H - 62, 134, 36, t(key("scanApply")), { font: body, size: 9.5, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/careers", W - 108, H - 76, 66, deep, "lifted"),
    ]),
  ]);
}

function lostPetFlyer({ t }: TemplateContext) {
  const red = "#dc2626";
  const crimson = "#991b1b";
  const ink = "#111827";
  const yellow = "#facc15";
  const display = FONTS.bebas;
  const body = FONTS.montserrat;
  const strips = 7;
  const left = 40;
  const strip = (W - left * 2) / strips;
  const tearTop = H - 138;
  const name = t(key("petName"));
  const phone = t("studio.tpl.phone");
  return design(t("studio.templates.items.lostPetFlyer"), [red, yellow, ink, "#fffdf7"], [
    pageOf(A4, solid("#fffdf7"), [
      box("rect", 0, 0, W, 132, gradient(135, ["#ef4444", crimson])),
      art("diagonalHatch", { primary: "#ffffff", secondary: "#fecaca" }, 0, 0, W, 132, { opacity: 0.22 }),
      centredText(PAGE, 14, 104, t(key("lostTitle")), { font: display, size: 104, color: "#ffffff", lineHeight: 1, valign: "middle", upper: true, spacing: 6, shrink: true, inset: 30, shadow: "deep" }),
      shadowed(box("rect", 60, 158, W - 120, 300, solid("#ffffff"), { radius: 6 }), "lifted"),
      ...photoCard(74, 172, W - 148, 248, "#e5e7eb", "none", "soft"),
      shadowed(box("burst", W - 186, 104, 156, 156, solid(yellow), { points: 20, inner: 0.84, rotation: 12 }), "lifted"),
      text(W - 166, 146, 116, 72, t(key("seenMe")), { font: FONTS.caveat, size: 25, bold: true, color: ink, align: "center", valign: "middle", lineHeight: 1, rotation: 12, shrink: true }),
      centredText(PAGE, 474, 48, name, { font: body, size: 38, bold: true, color: ink, valign: "middle", upper: true, spacing: 8, shrink: true }),
      shadowed(box("rect", 48, 532, 316, 100, solid("#ffffff"), { radius: 14 }), "soft"),
      box("rect", 48, 552, 4, 60, solid(red), { radius: 2 }),
      text(68, 540, 284, 84, t(key("petDetails")), { font: body, size: 10.5, color: "#374151", lineHeight: 1.55, valign: "middle", shrink: true }),
      shadowed(box("rect", W - 220, 532, 172, 100, gradient(135, [red, crimson]), { radius: 14 }), "lifted", crimson),
      text(W - 212, 546, 156, 18, t(key("reward")), { font: body, size: 11, bold: true, color: "#fee2e2", align: "center", upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(W - 212, 566, 156, 54, t(key("rewardAmount")), { font: display, size: 52, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      centredText(PAGE, 644, 18, t(key("pleaseCall")), { font: body, size: 12, bold: true, color: ink, valign: "middle", shrink: true }),
      centredText(PAGE, 662, 44, phone, { font: display, size: 44, color: red, valign: "middle", spacing: 2, shrink: true }),
      rule(20, tearTop, W - 40, "#9ca3af", 1, "dashed"),
      ...Array.from({ length: strips + 1 }, (_, index) => vrule(left + index * strip, tearTop + 6, H - tearTop - 16, "#c4c7cc", 0.8, "dashed")),
      ...Array.from({ length: strips }, (_, index) => {
        const centre = left + strip * (index + 0.5);
        const height = strip - 10;
        return text(centre - 58, tearTop + 6 + (H - tearTop - 16) / 2 - height / 2, 116, height, `${name}\n${phone}`, {
          runs: [{ text: `${name}\n`, bold: true }, { text: phone }],
          font: body,
          size: 9.5,
          color: ink,
          align: "center",
          valign: "middle",
          rotation: -90,
          shrink: true,
        });
      }),
    ]),
  ]);
}

function grandOpeningFlyer({ t }: TemplateContext) {
  const wine = "#3f0d1a";
  const rose = "#be123c";
  const gold = "#d6b25e";
  const cream = "#fbefd9";
  const display = FONTS.abril;
  const body = FONTS.montserrat;
  const perks = ["openingPerk1", "openingPerk2", "openingPerk3"];
  const column = (W - 112) / 3;
  return design(t("studio.templates.items.grandOpeningFlyer"), [wine, rose, gold, cream], [
    pageOf(A4, radial("#62182b", "#24060e", { cy: 0.3, radius: 1.05 }), [
      art("sunburst", { primary: "#7a2236", secondary: "#9c3a4a" }, 0, 0, W, H, { opacity: 0.22 }),
      art("confetti", { primary: gold, secondary: "#f9a8d4" }, 20, 20, W - 40, 320, { opacity: 0.6 }),
      box("rect", 18, 18, W - 36, H - 36, NONE, { stroke: stroke(gold, 1) }),
      box("rect", 24, 24, W - 48, H - 48, NONE, { stroke: stroke(gold, 0.5) }),
      centredText(PAGE, 62, 44, t(key("openingKicker")), { font: FONTS.dancing, size: 30, color: "#f3d9a4", valign: "middle", shrink: true }),
      centredText(PAGE, 110, 196, t("studio.tpl.grandOpening"), { font: display, size: 82, color: cream, lineHeight: 0.98, valign: "middle", shrink: true, inset: 44, shadow: "deep" }),
      art("ribbonBanner", { primary: rose, secondary: "#7f0d24" }, W / 2 - 206, 314, 412, 92),
      text(W / 2 - 160, 322, 320, 60, t("studio.tpl.openingDate"), { font: body, size: 14, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      shadowed(box("rect", 50, 424, W - 100, 218, foil("gold", 135), { radius: 16 }), "lifted"),
      ...photoCard(57, 431, W - 114, 204, "#74273a", "rounded", "soft"),
      shadowed(art("starSeal", { primary: "#c9a24a", secondary: "#fff3d6" }, W - 196, 372, 144, 144, { rotation: 10 }), "lifted"),
      text(W - 180, 412, 112, 64, t(key("openingOffer")), { font: body, size: 14, bold: true, color: wine, align: "center", valign: "middle", lineHeight: 1.1, rotation: 10, shrink: true }),
      ...perks.flatMap((perk, index) => {
        const x = 56 + index * column;
        return [
          box("diamond", x + column / 2 - 7, 664, 14, 14, foil("gold", 135)),
          text(x + 6, 686, column - 12, 36, t(key(perk)), { font: body, size: 11, bold: true, color: cream, align: "center", lineHeight: 1.25, shrink: true }),
        ];
      }),
      art("flourishDivider", { primary: gold, secondary: gold }, W / 2 - 110, 728, 220, 29),
      centredText(PAGE, 764, 20, t("studio.tpl.openingPlace"), { font: body, size: 12.5, bold: true, color: cream, valign: "middle", shrink: true }),
      centredText(PAGE, 786, 18, t("studio.tpl.website"), { font: body, size: 10.5, color: gold, spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function courseFlyer({ t }: TemplateContext) {
  const palette = PALETTES.cobaltSun;
  const navy = palette.ink;
  const blue = palette.accent;
  const sun = palette.accent2;
  const display = FONTS.poppins;
  const body = FONTS.inter;
  const split = W * 0.47;
  const hero = 468;
  const card = (W - 80 - 24) / 3;
  const column = (W - 80) / 2;
  const stats = [
    ["durationLabel", "courseDuration"],
    ["formatLabel", "courseFormat"],
    ["startLabel", "courseStart"],
  ];
  const modules = ["module1", "module2", "module3", "module4", "module5", "module6"];
  return design(t("studio.templates.items.courseFlyer"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", 0, 0, split, hero, gradient(170, [palette.paper, palette.soft])),
      art("honeycomb", { primary: "#c7d2fe", secondary: sun }, 0, 0, split, hero, { opacity: 0.35 }),
      ...photoCard(split, 0, W - split, hero, "#bfdbfe", "none", "soft"),
      art("blob", { primary: sun, secondary: "#fde68a" }, split - 28, hero - 176, 124, 124, { opacity: 0.95 }),
      ...pill(40, 52, 150, 26, blue, t(key("enrolOpen")), { font: display, size: 9.5 }),
      text(40, 96, 220, 200, t(key("courseTitle")), { font: display, size: 34, bold: true, color: navy, lineHeight: 1.08, valign: "middle", shrink: true }),
      box("rect", 40, 310, 56, 5, solid(sun), { radius: 2.5 }),
      text(40, 330, 190, 104, t(key("courseLead")), { font: body, size: 11.5, color: "#334155", lineHeight: 1.55, shrink: true }),
      ...stats.flatMap(([label, value], index) => {
        const x = 40 + index * (card + 12);
        return [
          shadowed(box("rect", x, hero - 34, card, 68, solid("#ffffff"), { radius: 14 }), "lifted", navy),
          text(x + 16, hero - 22, card - 32, 14, t(key(label)), { font: body, size: 8.5, bold: true, color: "#64748b", upper: true, spacing: 1, valign: "middle", shrink: true }),
          text(x + 16, hero - 4, card - 32, 26, t(key(value)), { font: display, size: 14, bold: true, color: blue, valign: "middle", shrink: true }),
        ];
      }),
      text(40, 558, 300, 24, t(key("learnHeading")), { font: display, size: 16, bold: true, color: navy, valign: "middle", shrink: true }),
      box("rect", 40, 586, 32, 3, solid(sun), { radius: 1.5 }),
      ...modules.flatMap((module, index) => {
        const x = 40 + (index % 2) * column;
        const y = 604 + Math.floor(index / 2) * 34;
        return [
          box("ellipse", x, y, 24, 24, solid(index % 2 ? sun : blue)),
          text(x, y, 24, 24, String(index + 1), { font: display, size: 10, bold: true, color: index % 2 ? navy : "#ffffff", align: "center", valign: "middle" }),
          text(x + 34, y - 2, column - 44, 28, t(key(module)), { font: body, size: 11, color: "#1e293b", valign: "middle", shrink: true }),
        ];
      }),
      box("rect", 0, H - 112, W, 112, gradient(120, [navy, "#1e3a8a"])),
      art("diagonalHatch", { primary: "#3b5bdb", secondary: sun }, 0, H - 112, W, 112, { opacity: 0.18 }),
      box("rect", 0, H - 112, W, 3, solid(sun)),
      text(40, H - 94, 220, 16, t(key("courseFeeLabel")), { font: body, size: 9.5, bold: true, color: "#93c5fd", upper: true, spacing: 1.5, valign: "middle", shrink: true }),
      text(40, H - 76, 220, 40, t(key("coursePrice")), { font: display, size: 32, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 34, 260, 18, t(key("earlyBird")), { font: body, size: 10, bold: true, color: sun, valign: "middle", shrink: true }),
      text(W - 272, H - 74, 136, 36, t(key("scanEnrol")), { font: body, size: 10, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/enrol", W - 124, H - 98, 84, navy),
    ]),
  ]);
}

function charityFlyer({ t }: TemplateContext) {
  const orange = "#ea580c";
  const orangeInk = "#c2410c";
  const brown = "#7c2d12";
  const peach = "#fed7aa";
  const paper = "#fff7ed";
  const display = FONTS.playfair;
  const body = FONTS.inter;
  const column = (W - 80 - 24) / 3;
  const details = [
    ["whenLabel", "charityWhen", "star"],
    ["whereLabel", "charityWhere", "pentagon"],
    ["entryLabel", "charityEntry", "heart"],
  ] as const;
  return design(t("studio.templates.items.charityFlyer"), [orange, brown, peach, paper], [
    pageOf(A4, solid(paper), [
      ...photoCard(0, 0, W, 380, "#fdba74", "none", "soft"),
      box("ellipse", -120, 332, W + 240, 160, solid(paper)),
      shadowed(box("ellipse", W / 2 - 40, 296, 80, 80, solid("#ffffff")), "lifted", brown),
      box("heart", W / 2 - 22, 320, 44, 38, gradient(135, ["#fb923c", orange])),
      centredText(PAGE, 394, 20, t(key("charityKicker")), { font: body, size: 11, bold: true, color: orangeInk, upper: true, spacing: 3, valign: "middle", shrink: true }),
      centredText(PAGE, 418, 88, t(key("charityTitle")), { font: display, size: 56, bold: true, color: brown, lineHeight: 1.02, valign: "middle", shrink: true, inset: 50 }),
      art("brushStroke", { primary: peach, secondary: "#fdba74" }, W / 2 - 90, 500, 180, 14, { opacity: 0.9 }),
      centredText(PAGE, 520, 42, t(key("charityLead")), { font: body, size: 11.5, color: "#57534e", lineHeight: 1.5, shrink: true, inset: 72 }),
      shadowed(box("rect", 56, 572, W - 112, 56, solid("#ffffff"), { radius: 14 }), "soft", brown),
      text(76, 582, 220, 16, t(key("raisedLabel")), { font: body, size: 9, bold: true, color: brown, upper: true, spacing: 1.5, valign: "middle", shrink: true }),
      text(W - 296, 582, 220, 16, t(key("raisedAmount")), { font: body, size: 10, bold: true, color: orangeInk, align: "right", valign: "middle", shrink: true }),
      box("rect", 76, 606, W - 152, 10, solid("#ffedd5"), { radius: 5 }),
      box("rect", 76, 606, (W - 152) * 0.62, 10, gradient(0, ["#fb923c", orange]), { radius: 5 }),
      ...details.flatMap(([label, value, shape], index) => {
        const x = 40 + index * (column + 12);
        const centre = x + column / 2;
        return [
          shadowed(box("rect", x, 644, column, 88, solid("#ffffff"), { radius: 14 }), "soft", brown),
          box("ellipse", centre - 14, 654, 28, 28, solid("#ffedd5")),
          box(shape, centre - 7, 661, 14, 14, solid(orange)),
          text(x + 8, 686, column - 16, 14, t(key(label)), { font: body, size: 8.5, bold: true, color: orangeInk, align: "center", upper: true, spacing: 1.5, valign: "middle", shrink: true }),
          text(x + 8, 700, column - 16, 28, t(key(value)), { font: body, size: 10.5, bold: true, color: brown, align: "center", lineHeight: 1.25, valign: "middle", shrink: true }),
        ];
      }),
      shadowed(box("rect", 40, H - 96, W - 80, 76, gradient(120, [brown, "#9a3412"]), { radius: 16 }), "lifted", brown),
      art("halftone", { primary: "#c2410c", secondary: "#fb923c" }, W / 2, H - 96, W / 2 - 40, 76, { opacity: 0.35 }),
      text(64, H - 86, 380, 26, t(key("donateCta")), { font: display, size: 18, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(64, H - 58, 380, 16, t("studio.tpl.website"), { font: body, size: 10.5, color: peach, valign: "middle", shrink: true }),
      text(64, H - 42, 380, 16, t("studio.tpl.orgName"), { font: body, size: 9.5, color: "#fdba74", valign: "middle", shrink: true }),
      ...qrCard("https://example.com/donate", W - 120, H - 88, 60, brown),
    ]),
  ]);
}

function serviceFlyer({ t }: TemplateContext) {
  const aqua = "#06b6d4";
  const navy = "#0c4a6e";
  const priceInk = "#0e7490";
  const yellow = "#fde047";
  const display = FONTS.poppins;
  const body = FONTS.inter;
  const reasons = ["serviceWhy1", "serviceWhy2", "serviceWhy3", "serviceWhy4"];
  const prices = [1, 2, 3, 4, 5, 6];
  const list = { x: 40, y: 416, width: W - 80, height: 256 };
  return design(t("studio.templates.items.serviceFlyer"), [aqua, navy, yellow, "#ffffff"], [
    pageOf(A4, gradient(180, ["#effcff", "#ffffff"]), [
      box("ellipse", W - 130, -50, 190, 190, solid("#cffafe")),
      box("ellipse", W - 360, -64, 110, 110, solid("#e0f2fe")),
      box("ellipse", -54, 352, 120, 120, solid("#ecfeff")),
      art("blob", { primary: "#a5f3fc", secondary: "#67e8f9" }, W - 320, 60, 290, 290, { opacity: 0.45 }),
      shadowed(box("ellipse", 40, 38, 36, 36, gradient(135, [aqua, priceInk])), "soft", priceInk),
      box("star", 48, 46, 20, 20, solid("#ffffff"), { points: 4, inner: 0.35 }),
      text(86, 36, 230, 22, t(key("serviceBrand")), { font: display, size: 15, bold: true, color: navy, valign: "middle", shrink: true }),
      text(86, 58, 230, 16, t(key("serviceTagline")), { font: body, size: 9.5, color: "#5b6b7f", valign: "middle", shrink: true }),
      box("ellipse", W - 292, 80, 256, 256, NONE, { stroke: stroke(aqua, 2, "dashed") }),
      ...photoCard(W - 280, 92, 232, 232, "#cffafe", "circle", "lifted", navy),
      box("star", W - 304, 292, 30, 30, solid(aqua), { points: 4, inner: 0.3 }),
      box("star", W - 66, 62, 22, 22, solid("#facc15"), { points: 4, inner: 0.3 }),
      text(40, 110, 262, 156, t(key("serviceTitle")), { font: display, size: 30, bold: true, color: navy, lineHeight: 1.12, valign: "middle", shrink: true }),
      box("rect", 40, 274, 48, 4, gradient(0, [aqua, yellow]), { radius: 2 }),
      shadowed(box("burst", W - 172, 248, 124, 124, solid(yellow), { points: 18, inner: 0.82 }), "lifted", navy),
      text(W - 160, 280, 100, 60, t(key("serviceOffer")), { font: display, size: 12, bold: true, color: navy, align: "center", valign: "middle", lineHeight: 1.1, rotation: -8, shrink: true }),
      ...reasons.flatMap((reason, index) => {
        const y = 294 + index * 26;
        return [
          box("ellipse", 40, y + 4, 14, 14, solid(aqua)),
          box("ellipse", 45, y + 9, 4, 4, solid("#ffffff")),
          text(62, y, 250, 22, t(key(reason)), { font: body, size: 11, color: "#334155", valign: "middle", shrink: true }),
        ];
      }),
      shadowed(box("rect", list.x, list.y, list.width, list.height, solid("#ffffff"), { radius: 18 }), "lifted", navy),
      box("rect", list.x, list.y, list.width, 52, gradient(0, [navy, priceInk]), { radius: 18 }),
      box("rect", list.x, list.y + 26, list.width, 26, gradient(0, [navy, priceInk])),
      text(list.x + 24, list.y + 12, 260, 28, t("studio.tpl.priceList"), { font: display, size: 17, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(list.x + list.width - 224, list.y + 16, 200, 20, t(key("pricesNote")), { font: body, size: 9.5, color: "#cffafe", align: "right", valign: "middle", shrink: true }),
      ...prices.flatMap((item, index) => {
        const y = list.y + 66 + index * 30;
        return [
          text(list.x + 24, y, 300, 24, t(key(`serviceItem${item}`)), { font: body, size: 11.5, color: navy, valign: "middle", shrink: true }),
          text(list.x + list.width - 174, y, 150, 24, t(key(`servicePrice${item}`)), { font: display, size: 12, bold: true, color: priceInk, align: "right", valign: "middle", shrink: true }),
          ...(index < prices.length - 1 ? [rule(list.x + 24, y + 28, list.width - 48, "#a5f3fc", 0.8, "dotted")] : []),
        ];
      }),
      art("waves", { primary: aqua, secondary: navy }, 0, H - 146, W, 40, { opacity: 0.8 }),
      box("rect", 0, H - 116, W, 116, gradient(0, [navy, "#083344"])),
      text(40, H - 98, 300, 18, t(key("serviceCta")), { font: body, size: 10.5, bold: true, color: "#a5f3fc", upper: true, spacing: 1.5, valign: "middle", shrink: true }),
      text(40, H - 78, 270, 40, t("studio.tpl.phone"), { font: display, size: 28, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 34, 270, 18, t("studio.tpl.website"), { font: body, size: 10.5, color: "#e0f2fe", valign: "middle", shrink: true }),
      text(W - 266, H - 74, 132, 36, t(key("scanBook")), { font: body, size: 10, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/book", W - 122, H - 100, 82, navy),
    ]),
  ]);
}

function campaignFlyer({ t }: TemplateContext) {
  const { width, height } = sizeOf(A5);
  const ink = "#111827";
  const magenta = "#db2777";
  const display = FONTS.bebas;
  const body = FONTS.montserrat;
  const coupon = { x: 28, y: 490, width: width - 56, height: 60 };
  return design(t("studio.templates.items.campaignFlyer"), [magenta, ink, "#facc15", "#ffffff"], [
    pageOf(A5, gradient(160, ["#fef08a", "#facc15"]), [
      art("sunburst", { primary: "#fde047", secondary: "#fbbf24" }, -60, -40, width + 120, height * 0.8, { opacity: 0.55 }),
      art("confetti", { primary: magenta, secondary: ink }, 0, 0, width, 230, { opacity: 0.28 }),
      ...pill(28, 28, 140, 24, ink, t(key("campaignKicker")), { font: body, size: 9 }),
      text(28, 62, width - 56, 164, t(key("campaignTitle")), { font: display, size: 100, color: ink, lineHeight: 0.86, valign: "middle", shrink: true }),
      shadowed(box("rect", 22, 232, 222, 200, solid("#ffffff"), { radius: 16 }), "lifted"),
      ...photoCard(30, 240, 206, 184, "#fde68a", "rounded", "soft"),
      box("ellipse", width - 206, 206, 190, 190, NONE, { stroke: stroke(magenta, 1.5, "dashed") }),
      shadowed(box("ellipse", width - 198, 214, 174, 174, gradient(135, ["#ec4899", "#be185d"])), "lifted", "#831843"),
      text(width - 171, 248, 120, 18, t(key("upTo")), { font: body, size: 10.5, bold: true, color: "#ffffff", align: "center", upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(width - 179, 264, 136, 84, t(key("campaignDiscount")), { font: display, size: 60, color: "#ffffff", align: "center", valign: "middle", lineHeight: 0.9, rotation: -6, shrink: true }),
      text(252, 404, width - 280, 26, t(key("campaignWhere")), { font: body, size: 11.5, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
      text(28, 444, width - 56, 36, t(key("campaignLead")), { font: body, size: 10.5, color: "#1f2937", lineHeight: 1.45, valign: "middle", shrink: true }),
      shadowed(box("rect", coupon.x, coupon.y, coupon.width, coupon.height, solid("#ffffff"), { radius: 10, stroke: stroke(ink, 1.2, "dashed") }), "soft"),
      box("ellipse", coupon.x - 9, coupon.y + coupon.height / 2 - 9, 18, 18, solid("#fbd23a")),
      box("ellipse", coupon.x + coupon.width - 9, coupon.y + coupon.height / 2 - 9, 18, 18, solid("#facc15")),
      text(coupon.x + 20, coupon.y + 8, 170, 14, t(key("couponLabel")), { font: body, size: 8.5, bold: true, color: "#6b7280", upper: true, spacing: 1.5, valign: "middle", shrink: true }),
      text(coupon.x + 20, coupon.y + 22, 180, 32, t(key("couponCode")), { font: display, size: 30, color: magenta, valign: "middle", spacing: 2, shrink: true }),
      vrule(coupon.x + 212, coupon.y + 10, coupon.height - 20, "#d1d5db", 1),
      text(coupon.x + 226, coupon.y + 6, coupon.width - 246, coupon.height - 12, t(key("campaignValid")), { font: body, size: 9.5, color: ink, valign: "middle", lineHeight: 1.35, shrink: true }),
      text(28, height - 32, width - 56, 18, t("studio.tpl.website"), { font: body, size: 10.5, bold: true, color: ink, align: "center", spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function programmeFlyer({ t }: TemplateContext) {
  const palette = PALETTES.forestCream;
  const green = palette.accent;
  const forest = darker(palette.accent, 0.35);
  const timeInk = "#8a5a12";
  const display = FONTS.playfair;
  const body = FONTS.inter;
  const header = 248;
  const slots = [1, 2, 3, 4, 5, 6, 7];
  return design(t("studio.templates.items.programmeFlyer"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", 0, 0, W, header, gradient(135, [green, forest])),
      art("topographic", { primary: "#4f7a5c", secondary: palette.accent2 }, 0, 0, W, header, { opacity: 0.35 }),
      art("botanicalSprig", { primary: "#7fa486", secondary: palette.accent2 }, W - 120, 26, 70, 140, { rotation: 18, opacity: 0.85 }),
      art("botanicalSprig", { primary: "#7fa486", secondary: palette.accent2 }, W - 168, 70, 54, 108, { rotation: -16, opacity: 0.6 }),
      text(40, 46, 300, 18, t(key("programmeKicker")), { font: body, size: 10.5, bold: true, color: "#f2cf7e", upper: true, spacing: 4, valign: "middle", shrink: true }),
      text(40, 70, W - 200, 104, t(key("programmeTitle")), { font: display, size: 46, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "middle", shrink: true }),
      text(40, 180, W - 160, 22, t(key("programmeDate")), { font: body, size: 12.5, color: "#e7efe4", valign: "middle", shrink: true }),
      box("rect", 40, 214, 56, 3, foil("gold", 0), { radius: 1.5 }),
      box("rect", 0, header, W, 4, foil("gold", 0)),
      vrule(126, 278, 404, "#d8d2bd", 2),
      ...slots.flatMap((slot, index) => {
        const y = 276 + index * 60;
        const headline = index === slots.length - 1;
        return [
          ...(headline ? [shadowed(box("rect", 140, y - 9, W - 172, 54, solid("#fbefcf"), { radius: 12 }), "soft", forest)] : []),
          text(36, y, 76, 22, t(key(`slotTime${slot}`)), { font: body, size: 12, bold: true, color: timeInk, align: "right", valign: "middle", shrink: true }),
          box("ellipse", 119, y + 4, 14, 14, headline ? foil("gold", 135) : solid(green), { stroke: stroke(palette.paper, 2.5) }),
          text(152, y, W - 200, 22, t(key(`slot${slot}`)), { font: display, size: 14, bold: true, color: palette.ink, valign: "middle", shrink: true }),
          text(152, y + 22, W - 200, 16, t(key(`slotPlace${slot}`)), { font: body, size: 10, color: palette.muted, valign: "middle", shrink: true }),
        ];
      }),
      shadowed(box("rect", 40, 712, W - 80, 92, solid("#ffffff"), { radius: 16 }), "soft", forest),
      box("rect", 40, 728, 4, 60, solid(palette.accent2), { radius: 2 }),
      text(62, 724, 380, 24, t(key("programmeNote")), { font: display, size: 13, bold: true, color: green, valign: "middle", shrink: true }),
      text(62, 752, 380, 18, t("studio.tpl.address"), { font: body, size: 10.5, color: palette.muted, valign: "middle", shrink: true }),
      text(62, 772, 380, 18, t("studio.tpl.website"), { font: body, size: 10.5, bold: true, color: timeInk, valign: "middle", shrink: true }),
      qr("https://example.com/programme", W - 122, 724, 68, forest),
      box("rect", 0, H - 14, W, 14, gradient(0, [green, forest])),
      box("rect", 0, H - 14, W, 2, foil("gold", 0)),
    ]),
  ]);
}

function triFoldBrochure({ t }: TemplateContext) {
  const { width, height } = sizeOf(LANDSCAPE);
  const panel = width / 3;
  const m = 26;
  const inner = panel - m * 2;
  const palette = PALETTES.oceanMist;
  const blue = "#0369a1";
  const deep = "#0c2d48";
  const coral = "#ff7a59";
  const coralInk = "#b8431c";
  const tint = "#f0f9ff";
  const muted = "#526175";
  const display = FONTS.playfair;
  const body = FONTS.montserrat;
  const kicker = (x: number, y: number, name: string, color = coralInk) => text(x, y, inner, 18, t(key(name)), { font: body, size: 9, bold: true, color, upper: true, spacing: 3, valign: "middle", shrink: true });
  const heading = (x: number, y: number, name: string, size = 20) => text(x, y, inner, 52, t(key(name)), { font: display, size, bold: true, color: deep, lineHeight: 1.15, valign: "middle", shrink: true });
  const contacts = ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website", "studio.tpl.address"];
  const reasons = [1, 2, 3, 4];
  const tours = [1, 2, 3];
  const included = [1, 2, 3, 4, 5, 6];
  const flap = 0;
  const back = panel;
  const cover = panel * 2;
  const outside = pageOf(LANDSCAPE, solid("#ffffff"), [
    kicker(flap + m, 34, "whyHeading"),
    heading(flap + m, 56, "whyTitle"),
    box("rect", flap + m, 114, 32, 3, solid(coral), { radius: 1.5 }),
    ...reasons.flatMap((reason, index) => {
      const y = 134 + index * 68;
      return [
        shadowed(box("ellipse", flap + m, y, 30, 30, solid(index % 2 ? coralInk : blue)), "soft"),
        text(flap + m, y, 30, 30, String(reason), { font: body, size: 12, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
        text(flap + m + 42, y - 2, inner - 42, 20, t(key(`reason${reason}`)), { font: body, size: 11.5, bold: true, color: deep, valign: "middle", shrink: true }),
        text(flap + m + 42, y + 18, inner - 42, 38, t(key(`reasonBody${reason}`)), { font: body, size: 9, color: muted, lineHeight: 1.4, shrink: true }),
      ];
    }),
    shadowed(box("rect", flap + m, 418, inner, 146, solid("#fff4ef"), { radius: 16 }), "soft", coralInk),
    text(flap + m + 18, 422, 40, 44, "“", { font: display, size: 48, bold: true, color: coral, opacity: 0.5 }),
    text(flap + m + 18, 458, inner - 36, 70, t(key("testimonial")), { font: display, size: 12, italic: true, color: deep, lineHeight: 1.45, valign: "middle", shrink: true }),
    text(flap + m + 18, 534, inner - 36, 18, t(key("testimonialAuthor")), { font: body, size: 9, bold: true, color: coralInk, valign: "middle", shrink: true }),
    box("rect", back, 0, panel, height, solid(tint)),
    art("topographic", { primary: "#bae6fd", secondary: "#fed7aa" }, back, 0, panel, height, { opacity: 0.35 }),
    kicker(back + m, 34, "contactHeading"),
    heading(back + m, 56, "contactTitle"),
    ...contacts.flatMap((contact, index) => {
      const y = 132 + index * 40;
      return [
        box("ellipse", back + m, y, 26, 26, gradient(135, [blue, deep])),
        box("diamond", back + m + 8, y + 8, 10, 10, solid("#ffffff")),
        text(back + m + 38, y - 2, inner - 38, 30, t(contact), { font: body, size: 10.5, color: deep, valign: "middle", lineHeight: 1.25, shrink: true }),
      ];
    }),
    ...photoCard(back + m, 300, inner, 150, "#bae6fd", "rounded", "lifted", deep),
    ...qrCard("https://example.com/tours", back + m, 472, 84, deep),
    text(back + m + 98, 478, inner - 98, 72, t(key("scanTours")), { font: body, size: 10, color: deep, valign: "middle", lineHeight: 1.35, shrink: true }),
    ...photoCard(cover, 0, panel, 404, "#bae6fd", "none", "soft"),
    box("ellipse", cover - 30, 350, panel + 60, 130, gradient(180, [palette.accent, deep])),
    box("rect", cover, 414, panel, height - 414, solid(deep)),
    art("waves", { primary: "#1f6f8b", secondary: "#99c1b9" }, cover, height - 20, panel, 20, { opacity: 0.4 }),
    shadowed(box("rect", cover + m, 24, 200, 28, solid("#ffffff"), { radius: 14 }), "soft"),
    text(cover + m + 10, 24, 180, 28, t(key("travelBrand")), { font: body, size: 9.5, bold: true, color: deep, align: "center", valign: "middle", upper: true, spacing: 1.2, shrink: true }),
    text(cover + m, 404, inner, 20, t(key("brochureKicker")), { font: body, size: 9.5, bold: true, color: "#fdba74", align: "center", upper: true, spacing: 3, valign: "middle", shrink: true }),
    text(cover + m, 428, inner, 96, t(key("brochureTitle")), { font: display, size: 31, bold: true, color: "#ffffff", align: "center", lineHeight: 1.08, valign: "middle", shrink: true }),
    box("rect", cover + panel / 2 - 24, 530, 48, 2, foil("gold", 0)),
    text(cover + m, 540, inner, 34, t(key("brochureSubtitle")), { font: body, size: 9.5, color: "#bae6fd", align: "center", lineHeight: 1.4, valign: "middle", shrink: true }),
  ]);
  const one = 0;
  const two = panel;
  const three = panel * 2;
  const inside = pageOf(LANDSCAPE, solid("#ffffff"), [
    ...photoCard(one, 0, panel, 232, "#bae6fd", "none", "soft"),
    kicker(one + m, 252, "aboutHeading"),
    heading(one + m, 274, "aboutTitle"),
    text(one + m, 334, inner, 148, t(key("aboutBody")), { font: body, size: 9.5, color: muted, lineHeight: 1.6, shrink: true }),
    rule(one + m, 494, inner, "#e2e8f0", 1),
    ...[
      ["statTravellers", "statTravellersLabel"],
      ["statDestinations", "statDestinationsLabel"],
    ].flatMap(([value, label], index) => {
      const x = one + m + index * (inner / 2);
      return [
        text(x, 506, inner / 2 - 8, 32, t(key(value)), { font: display, size: 26, bold: true, color: blue, valign: "middle", shrink: true }),
        text(x, 540, inner / 2 - 8, 28, t(key(label)), { font: body, size: 8.5, bold: true, color: muted, upper: true, spacing: 1, lineHeight: 1.3, shrink: true }),
      ];
    }),
    box("rect", two, 0, panel, height, solid(tint)),
    art("topographic", { primary: "#bae6fd", secondary: "#fed7aa" }, two, 0, panel, height, { opacity: 0.35 }),
    kicker(two + m, 28, "toursHeading"),
    text(two + m, 50, inner, 36, t(key("toursTitle")), { font: display, size: 20, bold: true, color: deep, valign: "middle", shrink: true }),
    ...tours.flatMap((tour, index) => {
      const y = 100 + index * 160;
      return [
        ...photoCard(two + m, y, inner, 86, "#bae6fd", "rounded", "soft", deep),
        text(two + m, y + 94, inner - 104, 22, t(key(`tour${tour}`)), { font: body, size: 11, bold: true, color: deep, valign: "middle", shrink: true }),
        text(two + m, y + 116, inner - 104, 32, t(key(`tourMeta${tour}`)), { font: body, size: 8.5, color: muted, lineHeight: 1.35, shrink: true }),
        ...pill(two + panel - m - 96, y + 98, 96, 26, coral, t(key(`tourPrice${tour}`)), { font: body, size: 10, color: deep, upper: false, spacing: 0 }),
      ];
    }),
    kicker(three + m, 34, "includedHeading"),
    heading(three + m, 56, "includedTitle"),
    ...included.flatMap((item, index) => {
      const y = 124 + index * 32;
      return [
        box("ellipse", three + m, y + 5, 14, 14, solid("#e0f2fe")),
        box("ellipse", three + m + 4, y + 9, 6, 6, solid(blue)),
        text(three + m + 24, y, inner - 24, 24, t(key(`included${item}`)), { font: body, size: 10.5, color: deep, valign: "middle", shrink: true }),
      ];
    }),
    shadowed(box("rect", three + m, 334, inner, 228, gradient(160, [blue, deep]), { radius: 16 }), "lifted", deep),
    art("waves", { primary: "#38bdf8", secondary: "#99c1b9" }, three + m, 540, inner, 22, { opacity: 0.3 }),
    text(three + m + 20, 352, inner - 40, 18, t(key("bookHeading")), { font: body, size: 9.5, bold: true, color: "#fdba74", upper: true, spacing: 3, valign: "middle", shrink: true }),
    text(three + m + 20, 374, inner - 40, 60, t(key("bookTitle")), { font: display, size: 18, bold: true, color: "#ffffff", lineHeight: 1.2, valign: "middle", shrink: true }),
    text(three + m + 20, 440, inner - 40, 20, t("studio.tpl.phone"), { font: body, size: 13, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
    text(three + m + 20, 462, inner - 40, 18, t("studio.tpl.email"), { font: body, size: 10, color: "#bae6fd", valign: "middle", shrink: true }),
    ...qrCard("https://example.com/book", three + m + 20, 488, 60, deep),
    text(three + m + 92, 492, inner - 112, 52, t(key("scanBook")), { font: body, size: 9.5, color: "#ffffff", valign: "middle", lineHeight: 1.3, shrink: true }),
  ]);
  return design(t("studio.templates.items.triFoldBrochure"), [blue, coral, deep, tint], [outside, inside]);
}

function openHouseFlyer({ t }: TemplateContext) {
  const charcoal = "#1b1d22";
  const ivory = "#f6f1e7";
  const gold = "#c9a45c";
  const display = FONTS.cormorant;
  const body = FONTS.raleway;
  const own = (name: string) => t(`studio.tpl.openHouseFlyer${name}`);
  const split = 330;
  const panel = 600;
  const x = split + 28;
  const column = W - split - 56;
  const strip = (W - 64 - 24) / 3;
  const features = [1, 2, 3, 4];
  return design(t("studio.templates.items.openHouseFlyer"), [charcoal, gold, ivory, "#ffffff"], [
    pageOf(A4, solid(ivory), [
      ...photoCard(0, 0, split, 520, "#cfc8bb", "none", "soft"),
      box("rect", split, 0, W - split, panel, gradient(170, ["#272a31", charcoal])),
      art("diagonalHatch", { primary: gold, secondary: gold }, split, 0, W - split, panel, { opacity: 0.06 }),
      box("rect", split, 0, 3, panel, foil("gold", 90)),
      text(x, 48, column, 16, own("Kicker"), { font: body, size: 9.5, bold: true, color: gold, upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(x, 70, column, 118, own("Title"), { font: display, size: 56, bold: true, italic: true, color: ivory, lineHeight: 0.92, valign: "middle", shrink: true }),
      box("rect", x, 198, 40, 2, foil("gold", 0)),
      text(x, 214, column, 14, t(key("whenLabel")), { font: body, size: 8.5, bold: true, color: gold, upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(x, 232, column, 46, own("When"), { font: display, size: 19, bold: true, color: ivory, lineHeight: 1.15, valign: "middle", shrink: true }),
      text(x, 292, column, 14, t(key("whereLabel")), { font: body, size: 8.5, bold: true, color: gold, upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(x, 310, column, 34, t(key("homeAddress")), { font: body, size: 11, color: "#e7e1d6", lineHeight: 1.35, valign: "middle", shrink: true }),
      ...features.flatMap((feature, index) => {
        const y = 364 + index * 28;
        return [box("diamond", x, y + 6, 9, 9, foil("gold", 135)), text(x + 18, y, column - 18, 22, own(`Feature${feature}`), { font: body, size: 11, color: "#ffffff", valign: "middle", shrink: true })];
      }),
      rule(x, 494, column, "#4a4d55", 1),
      text(x, 506, column, 14, t(key("askingPrice")), { font: body, size: 8.5, bold: true, color: gold, upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(x, 524, column, 48, own("Price"), { font: display, size: 36, bold: true, color: ivory, valign: "middle", shrink: true }),
      box("rect", 32, 538, 40, 2, foil("gold", 0)),
      text(32, 548, split - 64, 56, own("Headline"), { font: display, size: 22, bold: true, color: charcoal, lineHeight: 1.12, valign: "middle", shrink: true }),
      ...[0, 1, 2].flatMap((index) => photoCard(32 + index * (strip + 12), 620, strip, 110, "#ddd6c8", "rounded", "soft")),
      box("rect", 0, H - 92, W, 92, solid(charcoal)),
      box("rect", 0, H - 92, W, 3, foil("gold", 0)),
      box("ellipse", 30, H - 78, 64, 64, foil("gold", 135)),
      ...photoCard(33, H - 75, 58, 58, "#3a3d44", "circle", "soft"),
      text(108, H - 78, 210, 22, t(key("agentName")), { font: display, size: 18, bold: true, color: ivory, valign: "middle", shrink: true }),
      text(108, H - 56, 210, 14, t(key("agentRole")), { font: body, size: 8.5, color: gold, valign: "middle", shrink: true }),
      text(108, H - 38, 210, 16, t("studio.tpl.phone"), { font: body, size: 11, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(108, H - 22, 210, 14, t("studio.tpl.email"), { font: body, size: 9, color: "#d6d0c4", valign: "middle", shrink: true }),
      text(W - 226, H - 70, 120, 44, t(key("scanTour")), { font: body, size: 9, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/open-house", W - 98, H - 82, 70, charcoal),
    ]),
  ]);
}

function restaurantPromoFlyer({ t }: TemplateContext) {
  const tomato = "#b8321f";
  const deep = "#7f1d12";
  const cream = "#fbf3e4";
  const olive = "#4d5d2a";
  const ink = "#2a1a12";
  const mustard = "#f2b84b";
  const display = FONTS.pacifico;
  const body = FONTS.montserrat;
  const own = (name: string) => t(`studio.tpl.restaurantPromoFlyer${name}`);
  const band = 300;
  const dishes = [1, 2, 3];
  return design(t("studio.templates.items.restaurantPromoFlyer"), [tomato, olive, mustard, cream, ink], [
    pageOf(A4, solid(cream), [
      box("rect", 0, 0, W, band, gradient(160, [tomato, deep])),
      art("diagonalHatch", { primary: "#ffffff", secondary: mustard }, 0, 0, W, band, { opacity: 0.08 }),
      art("halftone", { primary: mustard, secondary: "#ffffff" }, 0, band, W, H - band, { opacity: 0.08 }),
      centredText(PAGE, 40, 18, t("studio.tpl.restaurantName"), { font: body, size: 11, bold: true, color: "#fde4d0", upper: true, spacing: 5, valign: "middle", shrink: true }),
      centredText(PAGE, 62, 94, own("Title"), { font: display, size: 60, color: cream, valign: "middle", inset: 50, shrink: true, shadow: "subtle" }),
      centredText(PAGE, 160, 22, own("When"), { font: body, size: 12.5, bold: true, color: "#ffd98a", upper: true, spacing: 2, valign: "middle", inset: 60, shrink: true }),
      art("botanicalSprig", { primary: olive, secondary: mustard }, W / 2 - 214, 300, 74, 148, { rotation: -32 }),
      art("botanicalSprig", { primary: olive, secondary: mustard }, W / 2 + 140, 300, 74, 148, { rotation: 32 }),
      shadowed(box("ellipse", W / 2 - 132, 198, 264, 264, solid("#ffffff")), "lifted", deep),
      box("ellipse", W / 2 - 122, 208, 244, 244, NONE, { stroke: stroke("#ead9bd", 1.5) }),
      ...photoCard(W / 2 - 112, 218, 224, 224, "#f1d3b3", "circle", "soft"),
      shadowed(box("burst", W - 186, 214, 130, 130, solid(mustard), { points: 20, inner: 0.86, rotation: -10 }), "lifted", deep),
      text(W - 172, 248, 102, 62, own("Offer"), { font: body, size: 17, bold: true, color: ink, align: "center", valign: "middle", lineHeight: 1.05, upper: true, rotation: -10, shrink: true }),
      centredText(PAGE, 480, 36, own("SpecialsHeading"), { font: display, size: 25, color: tomato, valign: "middle", inset: 60, shrink: true }),
      art("flourishDivider", { primary: olive, secondary: olive }, W / 2 - 90, 520, 180, 26),
      ...dishes.flatMap((dish, index) => {
        const y = 560 + index * 58;
        return [
          text(64, y, W - 230, 22, own(`Dish${dish}`), { font: body, size: 14, bold: true, color: ink, valign: "middle", shrink: true }),
          text(64, y + 22, W - 230, 18, own(`Desc${dish}`), { font: body, size: 10.5, color: "#6b5444", valign: "middle", shrink: true }),
          text(W - 160, y, 96, 40, own(`Price${dish}`), { font: display, size: 20, color: tomato, align: "right", valign: "middle", shrink: true }),
          ...(index < dishes.length - 1 ? [rule(64, y + 49, W - 128, "#dcc6a6", 0.8, "dotted")] : []),
        ];
      }),
      box("rect", 0, H - 92, W, 92, gradient(90, [olive, "#36431c"])),
      box("rect", 0, H - 92, W, 3, solid(mustard)),
      text(40, H - 76, 300, 26, own("Cta"), { font: display, size: 19, color: cream, valign: "middle", shrink: true }),
      text(40, H - 46, 300, 16, t("studio.tpl.phone"), { font: body, size: 11, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 28, 300, 14, t("studio.tpl.address"), { font: body, size: 9.5, color: "#e6ead9", valign: "middle", shrink: true }),
      text(W - 230, H - 66, 124, 40, t(key("scanBook")), { font: body, size: 9.5, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/table", W - 98, H - 80, 68, olive),
    ]),
  ]);
}

function fitnessClassFlyer({ t }: TemplateContext) {
  const sand = "#f4ece1";
  const terracotta = "#a9472e";
  const clay = "#dc9e82";
  const sage = "#7d8f69";
  const ink = "#2f2420";
  const muted = "#6b5a52";
  const display = FONTS.josefin;
  const body = FONTS.nunito;
  const own = (name: string) => t(`studio.tpl.fitnessClassFlyer${name}`);
  const x = 300;
  const column = W - x - 40;
  const card = { x: 36, y: 480, width: W - 72, height: 236 };
  const rows: [string, number, string, number][] = [
    ["mondayShort", 1, "07:00", 1],
    ["tuesdayShort", 2, "18:30", 2],
    ["wednesdayShort", 3, "07:00", 3],
    ["thursdayShort", 2, "18:30", 2],
    ["saturdayShort", 1, "09:30", 2],
  ];
  return design(t("studio.templates.items.fitnessClassFlyer"), [terracotta, clay, sage, sand, ink], [
    pageOf(A4, solid(sand), [
      art("blob", { primary: clay, secondary: sage }, W - 250, -90, 340, 340, { opacity: 0.35 }),
      art("blob", { primary: sage, secondary: clay }, -110, 360, 260, 260, { opacity: 0.3, rotation: 120 }),
      { ...box("rect", 52, 58, 236, 396, NONE, { stroke: stroke(terracotta, 1.5) }), corners: [118, 118, 0, 0] as [number, number, number, number] },
      shadowed(box("rect", 36, 42, 236, 396, solid(clay), { radius: 118 }), "lifted", ink),
      { ...photo(36, 42, 236, 396, "rounded"), cornerRadius: 118 },
      text(x, 64, column, 18, own("Studio"), { font: body, size: 11, bold: true, color: terracotta, upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(x, 90, column, 156, own("Title"), { font: display, size: 50, bold: true, color: ink, upper: true, lineHeight: 1.0, valign: "middle", shrink: true }),
      box("rect", x, 256, 48, 3, solid(terracotta), { radius: 1.5 }),
      text(x, 272, column, 66, own("Lead"), { font: body, size: 12.5, color: muted, lineHeight: 1.5, shrink: true }),
      shadowed(box("ellipse", W - 158, 344, 112, 112, solid(terracotta)), "lifted", ink),
      box("ellipse", W - 150, 352, 96, 96, NONE, { stroke: stroke("#f4d3c4", 1, "dashed") }),
      text(W - 146, 366, 88, 68, own("Badge"), { font: display, size: 14, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, lineHeight: 1.1, shrink: true }),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#ffffff"), { radius: 18 }), "soft", ink),
      text(card.x + 24, card.y + 16, 240, 24, own("ScheduleHeading"), { font: display, size: 15, bold: true, color: ink, upper: true, spacing: 2, valign: "middle", shrink: true }),
      text(card.x + card.width - 244, card.y + 16, 220, 24, own("ScheduleNote"), { font: body, size: 10, color: muted, align: "right", valign: "middle", shrink: true }),
      ...rows.flatMap(([day, kind, time, level], index) => {
        const y = card.y + 52 + index * 36;
        return [
          ...(index ? [rule(card.x + 24, y, card.width - 48, "#efe6da", 1)] : []),
          text(card.x + 24, y + 4, 56, 28, t(`studio.tpl.${day}`), { font: display, size: 13, bold: true, color: terracotta, upper: true, valign: "middle", shrink: true }),
          text(card.x + 88, y + 4, 210, 28, own(`Class${kind}`), { font: body, size: 12.5, bold: true, color: ink, valign: "middle", shrink: true }),
          text(card.x + 304, y + 4, 60, 28, time, { font: body, size: 12, color: muted, valign: "middle" }),
          box("rect", card.x + card.width - 134, y + 8, 110, 20, solid("#e3eadb"), { radius: 10 }),
          text(card.x + card.width - 130, y + 8, 102, 20, own(`Level${level}`), { font: body, size: 9, bold: true, color: "#3f5233", align: "center", valign: "middle", shrink: true }),
        ];
      }),
      box("ellipse", 34, H - 96, 70, 70, solid(clay)),
      ...photoCard(38, H - 92, 62, 62, "#e8cbb9", "circle", "soft"),
      text(118, H - 94, 260, 22, own("Coach"), { font: display, size: 14, bold: true, color: ink, valign: "middle", shrink: true }),
      text(118, H - 70, 260, 18, t("studio.tpl.phone"), { font: body, size: 11.5, bold: true, color: terracotta, valign: "middle", shrink: true }),
      text(118, H - 50, 260, 16, t("studio.tpl.website"), { font: body, size: 10, color: muted, valign: "middle", shrink: true }),
      text(W - 238, H - 82, 120, 40, t(key("scanBook")), { font: body, size: 9.5, color: ink, align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      ...qrCard("https://example.com/classes", W - 110, H - 98, 72, ink),
    ]),
  ]);
}

function techMeetupFlyer({ t }: TemplateContext) {
  const night = "#0b1020";
  const panel = "#131b34";
  const green = "#4ade80";
  const violet = "#a78bfa";
  const muted = "#94a3b8";
  const line = "#25305a";
  const display = FONTS.poppins;
  const body = FONTS.inter;
  const own = (name: string) => t(`studio.tpl.techMeetupFlyer${name}`);
  const talks = [
    [1, "19:00"],
    [2, "19:30"],
    [3, "20:00"],
  ] as const;
  const perks = [1, 2, 3];
  const chip = (W - 72 - 24) / 3;
  return design(t("studio.templates.items.techMeetupFlyer"), [night, green, violet, panel, "#ffffff"], [
    pageOf(A4, solid(night), [
      art("triangleTiles", { primary: "#1b2547", secondary: violet }, 0, 0, W, H, { opacity: 0.22 }),
      box("ellipse", -180, -180, 440, 440, radial("#3b2a8a", night), { opacity: 0.6 }),
      box("ellipse", W - 220, 380, 380, 380, radial("#0f5c3a", night), { opacity: 0.45 }),
      shadowed(box("rect", 36, 52, W - 72, 236, solid(panel), { radius: 16, stroke: stroke(line, 1) }), "lifted", "#000000"),
      ...["#f87171", "#fbbf24", green].map((colour, index) => box("ellipse", 56 + index * 18, 68, 10, 10, solid(colour))),
      text(W - 236, 64, 180, 18, "meetup.sh", { font: body, size: 9, color: muted, align: "right", valign: "middle" }),
      rule(36, 96, W - 72, line, 1),
      text(60, 112, W - 120, 20, `> ${own("Kicker")}`, { runs: [{ text: "> ", color: green }, { text: own("Kicker") }], font: body, size: 11, bold: true, color: "#cbd5e1", valign: "middle", shrink: true }),
      text(60, 138, W - 120, 96, own("Title"), { font: display, size: 46, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "middle", shrink: true }),
      box("rect", 60, 244, 36, 3, solid(green), { radius: 1.5 }),
      text(60, 254, W - 120, 22, own("Date"), { font: body, size: 13, bold: true, color: green, valign: "middle", shrink: true }),
      text(36, 318, 220, 18, own("TalksHeading"), { font: body, size: 10.5, bold: true, color: violet, spacing: 3, upper: true, valign: "middle", shrink: true }),
      rule(232, 327, W - 268, line, 1),
      ...talks.flatMap(([talk, time], index) => {
        const y = 348 + index * 80;
        return [
          box("rect", 36, y, W - 72, 68, solid(panel), { radius: 14, stroke: stroke(line, 1) }),
          box("rect", 52, y + 20, 60, 28, solid(violet), { radius: 8 }),
          text(52, y + 20, 60, 28, time, { font: body, size: 11, bold: true, color: night, align: "center", valign: "middle" }),
          box("ellipse", 126, y + 12, 44, 44, NONE, { stroke: stroke(green, 1.2) }),
          ...photoCard(129, y + 15, 38, 38, "#25305a", "circle", "soft"),
          text(184, y + 12, W - 244, 24, own(`Talk${talk}`), { font: display, size: 13.5, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
          text(184, y + 36, W - 244, 18, own(`Speaker${talk}`), { font: body, size: 10.5, color: muted, valign: "middle", shrink: true }),
        ];
      }),
      ...perks.flatMap((perk, index) => {
        const x = 36 + index * (chip + 12);
        return [
          box("rect", x, 600, chip, 34, solid("#16213f"), { radius: 17, stroke: stroke(line, 1) }),
          box("ellipse", x + 14, 613, 8, 8, solid(green)),
          text(x + 28, 600, chip - 40, 34, own(`Perk${perk}`), { font: body, size: 10.5, bold: true, color: "#e2e8f0", valign: "middle", shrink: true }),
        ];
      }),
      text(36, 650, W - 72, 20, t("studio.tpl.address"), { font: body, size: 11, color: "#cbd5e1", valign: "middle", shrink: true }),
      box("rect", 0, H - 132, W, 132, gradient(0, [green, "#22c55e"])),
      art("diagonalHatch", { primary: "#ffffff", secondary: night }, W / 2, H - 132, W / 2, 132, { opacity: 0.12 }),
      text(36, H - 110, 330, 52, own("Cta"), { font: display, size: 22, bold: true, color: night, lineHeight: 1.15, valign: "middle", shrink: true }),
      text(36, H - 52, 330, 18, t("studio.tpl.website"), { font: body, size: 12, bold: true, color: night, valign: "middle", shrink: true }),
      text(36, H - 32, 330, 16, t("studio.tpl.orgName"), { font: body, size: 10, color: "#0f2a1a", valign: "middle", shrink: true }),
      ...qrCard("https://example.com/meetup", W - 128, H - 116, 92, night, "lifted"),
    ]),
  ]);
}

function foodDriveFlyer({ t }: TemplateContext) {
  const blue = "#1d3fa6";
  const deep = "#0f2466";
  const yellow = "#facc15";
  const sky = "#e8f0ff";
  const ink = "#0f1e46";
  const muted = "#4a5578";
  const display = FONTS.merriweather;
  const body = FONTS.nunito;
  const own = (name: string) => t(`studio.tpl.foodDriveFlyer${name}`);
  const hero = 356;
  const items = [1, 2, 3, 4, 5, 6];
  const half = (W - 80) / 2;
  const third = (W - 80) / 3;
  const facts = [
    [key("whenLabel"), own("When")],
    [key("whereLabel"), own("Where")],
    [`studio.tpl.foodDriveFlyerGoalLabel`, own("Goal")],
  ];
  return design(t("studio.templates.items.foodDriveFlyer"), [blue, deep, yellow, sky, "#ffffff"], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, hero, gradient(150, [blue, deep])),
      art("halftone", { primary: "#3b5fd1", secondary: yellow }, 0, 0, W, hero, { opacity: 0.3 }),
      box("rect", -40, hero - 34, W + 80, 72, solid("#ffffff"), { rotation: -4 }),
      text(40, 52, 300, 20, own("Kicker"), { font: body, size: 12, bold: true, color: yellow, upper: true, spacing: 2.5, valign: "middle", shrink: true }),
      text(40, 80, 300, 150, own("Title"), { font: display, size: 40, bold: true, color: "#ffffff", lineHeight: 1.12, valign: "middle", shrink: true }),
      box("rect", 40, 240, 56, 4, solid(yellow), { radius: 2 }),
      text(40, 254, 280, 52, own("Lead"), { font: body, size: 13, color: "#dbe5ff", lineHeight: 1.45, shrink: true }),
      shadowed(box("rect", W - 244, 64, 200, 240, solid("#ffffff"), { radius: 6, rotation: 4 }), "lifted", "#000000"),
      box("rect", W - 232, 76, 176, 180, solid("#dbe5ff"), { rotation: 4 }),
      { ...photo(W - 232, 76, 176, 180), rotation: 4 },
      text(W - 232, 262, 176, 30, own("Caption"), { font: FONTS.caveat, size: 17, bold: true, color: ink, align: "center", valign: "middle", rotation: 4, shrink: true }),
      shadowed(box("heart", W - 80, 40, 52, 46, solid(yellow), { rotation: 14 }), "lifted", deep),
      text(40, 394, 300, 28, own("BringHeading"), { font: display, size: 20, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", 40, 426, 44, 4, solid(yellow), { radius: 2 }),
      ...items.flatMap((item, index) => {
        const x = 40 + (index % 2) * half;
        const y = 446 + Math.floor(index / 2) * 34;
        return [box("ellipse", x, y + 4, 20, 20, solid(yellow)), box("ellipse", x + 7, y + 11, 6, 6, solid(ink)), text(x + 30, y, half - 40, 28, own(`Item${item}`), { font: body, size: 12.5, color: ink, valign: "middle", shrink: true })];
      }),
      shadowed(box("rect", 40, 566, W - 80, 96, solid(sky), { radius: 16 }), "soft", deep),
      ...facts.flatMap(([label, value], index) => {
        const x = 40 + index * third;
        return [
          ...(index ? [vrule(x, 582, 64, "#c3d2f5", 1)] : []),
          text(x + 18, 580, third - 32, 16, t(label), { font: body, size: 9, bold: true, color: blue, upper: true, spacing: 1.5, valign: "middle", shrink: true }),
          text(x + 18, 600, third - 32, 50, value, { font: display, size: 12, bold: true, color: ink, lineHeight: 1.3, valign: "middle", shrink: true }),
        ];
      }),
      centredText(PAGE, 676, 36, own("Note"), { font: body, size: 11, color: muted, lineHeight: 1.45, inset: 56, valign: "middle", shrink: true }),
      box("rect", 0, H - 112, W, 112, solid(yellow)),
      art("diagonalHatch", { primary: "#eab308", secondary: "#ffffff" }, 0, H - 112, W, 112, { opacity: 0.25 }),
      text(40, H - 94, 400, 44, own("Cta"), { font: display, size: 15, bold: true, color: ink, lineHeight: 1.25, valign: "middle", shrink: true }),
      text(40, H - 46, 330, 18, t("studio.tpl.phone"), { font: body, size: 12.5, bold: true, color: ink, valign: "middle", shrink: true }),
      text(40, H - 28, 330, 16, t("studio.tpl.website"), { font: body, size: 10.5, color: "#3b3209", valign: "middle", shrink: true }),
      ...qrCard("https://example.com/food-drive", W - 128, H - 100, 88, deep, "lifted"),
    ]),
  ]);
}

export const FLYER_TEMPLATES: StudioTemplate[] = [
  { id: "realEstateFlyer", category: "flyers", size: A4, build: realEstateFlyer },
  { id: "hiringFlyer", category: "flyers", size: A4, build: hiringFlyer },
  { id: "lostPetFlyer", category: "flyers", size: A4, build: lostPetFlyer },
  { id: "grandOpeningFlyer", category: "flyers", size: A4, build: grandOpeningFlyer },
  { id: "courseFlyer", category: "flyers", size: A4, build: courseFlyer },
  { id: "charityFlyer", category: "flyers", size: A4, build: charityFlyer },
  { id: "serviceFlyer", category: "flyers", size: A4, build: serviceFlyer },
  { id: "campaignFlyer", category: "flyers", size: A5, build: campaignFlyer },
  { id: "programmeFlyer", category: "flyers", size: A4, build: programmeFlyer },
  { id: "triFoldBrochure", category: "flyers", size: LANDSCAPE, build: triFoldBrochure },
  { id: "openHouseFlyer", category: "flyers", size: A4, build: openHouseFlyer },
  { id: "restaurantPromoFlyer", category: "flyers", size: A4, build: restaurantPromoFlyer },
  { id: "fitnessClassFlyer", category: "flyers", size: A4, build: fitnessClassFlyer },
  { id: "techMeetupFlyer", category: "flyers", size: A4, build: techMeetupFlyer },
  { id: "foodDriveFlyer", category: "flyers", size: A4, build: foodDriveFlyer },
];
