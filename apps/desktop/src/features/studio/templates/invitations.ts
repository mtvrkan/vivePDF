import type { StudioElement, StudioFill } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

const SIZE = "a5" as const;
const { width: W, height: H } = sizeOf(SIZE);
const page = { width: W, height: H };

function arch(x: number, y: number, width: number, height: number, fill: StudioFill, options: Parameters<typeof box>[6] = {}) {
  return { ...box("rect", x, y, width, height, fill, options), corners: [width / 2, width / 2, 0, 0] as [number, number, number, number] };
}

function balloon(x: number, y: number, size: number, color: string): StudioElement[] {
  return [
    box("rect", x + size / 2 - 0.5, y + size * 1.2, 1, size * 0.9, solid(darker(color, 0.15)), { opacity: 0.7 }),
    box("triangle", x + size / 2 - 5, y + size * 1.17, 10, 8, solid(darker(color, 0.12))),
    shadowed(box("ellipse", x, y, size, size * 1.22, gradient(135, [lighter(color, 0.25), color, darker(color, 0.18)])), "soft"),
    box("ellipse", x + size * 0.2, y + size * 0.18, size * 0.2, size * 0.3, solid("#ffffff"), { opacity: 0.5, rotation: -20 }),
  ];
}

function wedding({ t }: TemplateContext) {
  const palette = PALETTES.sageLinen;
  const sage = darker(palette.accent, 0.25);
  const gold = palette.accent2;
  const goldInk = darker(gold, 0.5);
  const colours = { primary: palette.accent, secondary: gold };
  const inner = 36;
  return design(t("studio.templates.items.wedding"), paletteList(palette), [
    pageOf(SIZE, radial("#fdfcf7", palette.soft, { cy: 0.42, radius: 1 }), [
      art("marble", { primary: lighter(palette.accent, 0.55), secondary: lighter(gold, 0.3) }, 0, 0, W, H, { opacity: 0.55 }),
      shadowed(box("rect", inner, inner, W - inner * 2, H - inner * 2, solid("#fffefa"), { stroke: stroke(gold, 0.8) }), "lifted"),
      box("rect", inner + 8, inner + 8, W - inner * 2 - 16, H - inner * 2 - 16, { type: "none" }, { stroke: stroke(lighter(gold, 0.2), 0.5) }),
      art("botanicalSprig", colours, W / 2 - 82, 30, 48, 96, { rotation: -62 }),
      art("botanicalSprig", colours, W / 2 + 34, 30, 48, 96, { rotation: 62 }),
      box("ellipse", W / 2 - 4, 74, 8, 8, foil("gold", 135)),
      centredText(page, 112, 18, t("studio.tpl.togetherWithFamilies"), { font: FONTS.cormorant, size: 11, bold: true, color: palette.muted, spacing: 3, upper: true, shrink: true, inset: 64 }),
      centredText(page, 136, 104, t("studio.tpl.coupleNames"), { font: FONTS.greatVibes, size: 50, color: sage, lineHeight: 1, shrink: true, valign: "middle", inset: 60 }),
      art("flourishDivider", colours, W / 2 - 80, 246, 160, 22),
      centredText(page, 280, 48, t("studio.tpl.weddingLine"), { font: FONTS.cormorant, size: 14.5, italic: true, color: palette.ink, lineHeight: 1.3, shrink: true, inset: 72 }),
      box("rect", W / 2 - 72, 338, 144, 1, foil("gold", 0)),
      centredText(page, 348, 24, t("studio.tpl.weddingDate"), { font: FONTS.cormorant, size: 16, bold: true, color: palette.ink, spacing: 2, upper: true, shrink: true, inset: 60 }),
      centredText(page, 374, 20, t("studio.tpl.weddingTime"), { font: FONTS.cormorant, size: 13.5, italic: true, color: palette.muted, shrink: true, inset: 72 }),
      box("rect", W / 2 - 72, 402, 144, 1, foil("gold", 0)),
      centredText(page, 414, 40, t("studio.tpl.venue"), { font: FONTS.cormorant, size: 13.5, color: palette.ink, lineHeight: 1.35, shrink: true, inset: 72 }),
      centredText(page, 462, 36, t("studio.tpl.reception"), { font: FONTS.greatVibes, size: 25, color: goldInk, shrink: true, inset: 92, valign: "middle" }),
      art("botanicalSprig", colours, inner + 14, H - inner - 92, 36, 72, { rotation: -32, opacity: 0.85 }),
      art("botanicalSprig", colours, W - inner - 50, H - inner - 92, 36, 72, { rotation: 32, opacity: 0.85 }),
      centredText(page, 516, 18, t("studio.tpl.rsvp"), { font: FONTS.cormorant, size: 10.5, bold: true, color: palette.muted, spacing: 2.5, upper: true, shrink: true, inset: 104 }),
    ]),
  ]);
}

function birthday({ t }: TemplateContext) {
  const coral = "#f43f5e";
  const sun = "#f59e0b";
  const sky = "#0ea5e9";
  const violet = "#6d28d9";
  const ink = "#2a1238";
  const cardTop = 348;
  return design(t("studio.templates.items.birthday"), [coral, sun, sky, violet], [
    pageOf(SIZE, gradient(170, ["#fff7ed", "#ffe4e6", "#fce7f3"]), [
      art("blob", { primary: sun, secondary: coral }, -110, -90, 280, 280, { opacity: 0.28 }),
      art("blob", { primary: sky, secondary: violet }, W - 160, H - 210, 280, 280, { opacity: 0.24, rotation: 120 }),
      art("confetti", { primary: coral, secondary: sky }, 16, 12, W - 32, 220, { opacity: 0.75 }),
      art("confetti", { primary: violet, secondary: sun }, 24, H - 150, W - 48, 130, { opacity: 0.45 }),
      ...balloon(40, 56, 72, coral),
      ...balloon(W - 116, 40, 78, sky),
      ...balloon(W / 2 - 32, 20, 64, sun),
      centredText(page, 200, 64, t("studio.tpl.letsCelebrate"), { font: FONTS.pacifico, size: 40, color: "#e11d48", shrink: true, valign: "middle", inset: 32 }),
      centredText(page, 264, 44, t("studio.tpl.birthdayName"), { font: FONTS.nunito, size: 28, bold: true, color: ink, shrink: true, valign: "middle", inset: 40 }),
      shadowed(box("rect", 48, cardTop, W - 96, 156, solid("#ffffff"), { radius: 24, stroke: stroke("#fecdd3", 1.5, "dashed") }), "lifted", coral),
      shadowed(box("rect", W / 2 - 104, cardTop - 18, 208, 36, gradient(90, ["#e11d48", "#be185d"]), { radius: 18 }), "soft", coral),
      centredText(page, cardTop - 18, 36, t("studio.tpl.birthdayDate"), { font: FONTS.nunito, size: 15, bold: true, color: "#ffffff", shrink: true, valign: "middle", inset: W / 2 - 96 }),
      centredText(page, cardTop + 34, 28, t("studio.tpl.birthdayTime"), { font: FONTS.nunito, size: 20, bold: true, color: ink, shrink: true, valign: "middle", inset: 72 }),
      centredText(page, cardTop + 64, 36, t("studio.tpl.birthdayPlace"), { font: FONTS.nunito, size: 13, color: "#4b5563", lineHeight: 1.35, shrink: true, inset: 72 }),
      art("dotsDivider", { primary: coral, secondary: sun }, W / 2 - 60, cardTop + 104, 120, 8),
      centredText(page, cardTop + 116, 28, t("studio.tpl.birthdayRsvp"), { font: FONTS.nunito, size: 13, bold: true, color: violet, shrink: true, valign: "middle", inset: 72 }),
    ]),
  ]);
}

function party({ t }: TemplateContext) {
  const pink = "#f472b6";
  const violet = "#8b5cf6";
  const cyan = "#22d3ee";
  return design(t("studio.templates.items.party"), [pink, violet, cyan, "#08070f"], [
    pageOf(SIZE, radial("#2b1055", "#08070f", { cx: 0.3, cy: 0.25, radius: 1.1 }), [
      art("sunburst", { primary: "#3b1a6b", secondary: pink }, -W * 0.4, -H * 0.25, W * 1.4, H, { opacity: 0.22 }),
      art("blob", { primary: violet, secondary: pink }, -110, -100, 320, 320, { opacity: 0.85 }),
      art("blob", { primary: pink, secondary: cyan }, W - 170, H - 230, 300, 300, { opacity: 0.7, rotation: 200 }),
      shadowed(art("arcRings", { primary: cyan, secondary: pink }, W - 176, 36, 144, 144), "glow", cyan),
      art("halftone", { primary: "#ffffff", secondary: cyan }, 0, H - 260, W, 260, { opacity: 0.12 }),
      text(40, 144, W - 80, 20, t("studio.tpl.youAreInvited"), { font: FONTS.montserrat, size: 11, bold: true, color: cyan, spacing: 4, upper: true, shrink: true }),
      text(36, 168, W - 72, 184, t("studio.tpl.partyNight"), { font: FONTS.bebas, size: 108, color: "#ffffff", lineHeight: 0.86, shrink: true, valign: "middle", shadow: { color: pink, x: 3, y: 3, opacity: 0.55 } }),
      text(40, 360, W - 80, 22, t("studio.tpl.partyLine"), { font: FONTS.montserrat, size: 12.5, bold: true, color: pink, spacing: 3, upper: true, shrink: true }),
      box("rect", 40, 392, 104, 3, gradient(0, [cyan, violet, pink]), { radius: 1.5 }),
      shadowed(box("rect", 32, 416, W - 64, 92, solid("#ffffff"), { radius: 16, opacity: 0.08, stroke: stroke(pink, 1) }), "glow", pink),
      box("rect", 52, 434, 3, 56, gradient(90, [cyan, pink]), { radius: 1.5 }),
      text(68, 432, W - 132, 24, t("studio.tpl.partyDate"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", shrink: true, valign: "middle" }),
      text(68, 460, W - 132, 32, t("studio.tpl.partyPlace"), { font: FONTS.montserrat, size: 12.5, color: "#e9d5ff", shrink: true, valign: "middle" }),
      text(40, 536, W - 80, 18, t("studio.tpl.dressCode"), { font: FONTS.montserrat, size: 10, bold: true, color: "#c4b5fd", spacing: 2.5, upper: true, shrink: true }),
    ]),
  ]);
}

function babyShower({ t }: TemplateContext) {
  const navy = "#2f5f99";
  const sky = "#9cc3ec";
  const pink = "#f4a6c6";
  const rose = "#b0386f";
  const ink = "#1f2a44";
  const cloud = (x: number, y: number, width: number, opacity = 1) => shadowed(box("cloud", x, y, width, width * 0.6, solid("#ffffff"), { opacity }), "soft", navy);
  return design(t("studio.templates.items.babyShower"), [navy, sky, pink, rose], [
    pageOf(SIZE, radial("#ffffff", "#e6effa", { cy: 0.32, radius: 1 }), [
      art("blob", { primary: pink, secondary: "#fde2ec" }, -90, H - 190, 250, 250, { opacity: 0.45 }),
      art("blob", { primary: sky, secondary: "#e0edfb" }, W - 150, -70, 240, 240, { opacity: 0.5, rotation: 90 }),
      art("confetti", { primary: pink, secondary: sky }, 16, 16, W - 32, 260, { opacity: 0.5 }),
      cloud(-24, 96, 120, 0.95),
      cloud(W - 112, 196, 132, 0.95),
      shadowed(art("scallopSeal", { primary: "#ffffff", secondary: sky }, W / 2 - 100, 52, 200, 200), "lifted", navy),
      box("ellipse", W / 2 - 74, 78, 148, 148, radial("#ffffff", "#eef5fd"), { stroke: stroke(pink, 1.2, "dotted") }),
      centredText(page, 112, 80, t("studio.tpl.ohBaby"), { font: FONTS.dancing, size: 42, bold: true, color: navy, shrink: true, inset: W / 2 - 68, valign: "middle", lineHeight: 1 }),
      centredText(page, 276, 40, t("studio.tpl.babyShowerFor"), { font: FONTS.nunito, size: 13, color: "#4b5568", lineHeight: 1.35, spacing: 0.5, shrink: true, inset: 64, valign: "middle" }),
      centredText(page, 320, 44, t("studio.tpl.parentName"), { font: FONTS.nunito, size: 28, bold: true, color: ink, shrink: true, valign: "middle", inset: 48 }),
      art("dotsDivider", { primary: pink, secondary: navy }, W / 2 - 72, 372, 144, 10),
      shadowed(box("rect", 56, 396, W - 112, 104, solid("#ffffff"), { radius: 22, stroke: stroke("#dbe7f6", 1) }), "soft", navy),
      centredText(page, 412, 24, t("studio.tpl.showerDate"), { font: FONTS.nunito, size: 15, bold: true, color: rose, shrink: true, valign: "middle", inset: 72 }),
      centredText(page, 442, 44, t("studio.tpl.showerPlace"), { font: FONTS.nunito, size: 13, color: "#4b5563", lineHeight: 1.35, shrink: true, inset: 72 }),
      centredText(page, 528, 18, t("studio.tpl.rsvp"), { font: FONTS.nunito, size: 10.5, bold: true, color: "#4b5568", spacing: 2, upper: true, shrink: true, inset: 72 }),
    ]),
  ]);
}

function graduation({ t }: TemplateContext) {
  const night = "#0b1730";
  const gold = "#d4af5a";
  const goldText = "#e7cd8a";
  const mist = "#d3dae8";
  const colours = { primary: gold, secondary: gold };
  return design(t("studio.templates.items.graduation"), [night, "#21407a", gold, "#ffffff"], [
    pageOf(SIZE, radial("#21407a", night, { cy: 0.32, radius: 1 }), [
      art("topographic", { primary: "#3b5f9e", secondary: gold }, 0, 0, W, H, { opacity: 0.22 }),
      frame("gemFrame", colours, page),
      centredText(page, 60, 20, t("studio.tpl.classOf"), { font: FONTS.cinzel, size: 13, bold: true, color: goldText, spacing: 6, upper: true, shrink: true, inset: 64 }),
      shadowed(art("laurel", colours, W / 2 - 100, 82, 200, 191), "soft"),
      centredText(page, 144, 64, "2027", { font: FONTS.cinzel, size: 38, bold: true, color: "#ffffff", spacing: 2, valign: "middle", inset: W / 2 - 64 }),
      centredText(page, 268, 76, t("studio.tpl.graduationTitle"), { font: FONTS.cinzel, size: 26, bold: true, color: "#ffffff", spacing: 1.5, lineHeight: 1.15, upper: true, shrink: true, valign: "middle", inset: 48 }),
      box("rect", W / 2 - 60, 352, 120, 2, foil("gold", 0)),
      centredText(page, 368, 44, t("studio.tpl.graduationLine"), { font: FONTS.lora, size: 13.5, italic: true, color: mist, lineHeight: 1.4, shrink: true, inset: 64 }),
      shadowed(box("rect", 64, 428, W - 128, 40, foil("gold", 0), { radius: 20 }), "lifted"),
      centredText(page, 428, 40, t("studio.tpl.graduationDate"), { font: FONTS.lora, size: 14, bold: true, color: night, shrink: true, valign: "middle", inset: 80 }),
      centredText(page, 484, 44, t("studio.tpl.graduationPlace"), { font: FONTS.lora, size: 13, color: mist, lineHeight: 1.4, shrink: true, inset: 64 }),
    ]),
  ]);
}

function corporate({ t }: TemplateContext) {
  const ink = "#0b1f33";
  const teal = "#0d9488";
  const tealInk = "#0f766e";
  const mint = "#5eead4";
  const slate = "#475569";
  const header = 272;
  const card = { x: 28, y: 232, width: W - 56, height: 220 };
  return design(t("studio.templates.items.corporateEvent"), [ink, teal, mint, "#f4f7f8"], [
    pageOf(SIZE, solid("#f4f7f8"), [
      box("rect", 0, 0, W, header, gradient(140, [ink, "#0f3d3e", "#115e59"])),
      art("topographic", { primary: teal, secondary: mint }, 0, 0, W, header, { opacity: 0.35 }),
      art("arcRings", { primary: teal, secondary: mint }, W - 176, -56, 240, 240, { opacity: 0.75 }),
      text(36, 44, W - 72, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: mint, spacing: 3, upper: true, shrink: true }),
      text(36, 72, W - 120, 22, t("studio.tpl.youAreInvited"), { font: FONTS.montserrat, size: 13, color: "#cbd5e1", shrink: true }),
      text(36, 98, W - 112, 96, t("studio.tpl.corporateTitle"), { font: FONTS.montserrat, size: 32, bold: true, color: "#ffffff", lineHeight: 1.08, shrink: true, valign: "middle" }),
      box("rect", 36, 204, 48, 4, solid(mint), { radius: 2 }),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#ffffff"), { radius: 16 }), "lifted"),
      text(card.x + 24, card.y + 22, card.width - 48, 64, t("studio.tpl.corporateBody"), { font: FONTS.inter, size: 12, color: "#374151", lineHeight: 1.5, shrink: true }),
      rule(card.x + 24, card.y + 100, card.width - 48, "#e2e8f0", 1),
      box("rect", card.x + 24, card.y + 118, 4, 80, gradient(90, [teal, mint]), { radius: 2 }),
      text(card.x + 40, card.y + 116, card.width - 64, 22, t("studio.tpl.corporateDate"), { font: FONTS.inter, size: 14, bold: true, color: ink, shrink: true, valign: "middle" }),
      text(card.x + 40, card.y + 140, card.width - 64, 20, t("studio.tpl.corporateTime"), { font: FONTS.inter, size: 12.5, color: slate, shrink: true, valign: "middle" }),
      text(card.x + 40, card.y + 164, card.width - 64, 36, t("studio.tpl.corporatePlace"), { font: FONTS.inter, size: 12, color: slate, lineHeight: 1.35, shrink: true }),
      shadowed(box("rect", W - 136, 476, 100, 100, solid("#ffffff"), { radius: 12 }), "soft"),
      qr("https://example.com/rsvp", W - 128, 484, 84, ink),
      text(36, 492, W - 192, 22, t("studio.tpl.scanToRsvp"), { font: FONTS.montserrat, size: 14, bold: true, color: tealInk, shrink: true }),
      text(36, 518, W - 192, 40, t("studio.tpl.rsvpBy"), { font: FONTS.inter, size: 12, color: slate, lineHeight: 1.4, shrink: true }),
      box("rect", 0, H - 8, W, 8, gradient(0, [ink, teal, mint])),
    ]),
  ]);
}

function dinner({ t }: TemplateContext) {
  const night = "#061510";
  const gold = "#d4b06a";
  const cream = "#f5ecd7";
  const mist = "#cfdcd4";
  const colours = { primary: gold, secondary: gold };
  const x = 52;
  const y = 52;
  const width = W - x * 2;
  const height = H - y * 2;
  return design(t("studio.templates.items.dinner"), [night, "#16432f", gold, cream], [
    pageOf(SIZE, radial("#16432f", night, { cy: 0.38, radius: 1.05 }), [
      art("sunburst", { primary: "#1f5a40", secondary: gold }, 0, 0, W, H, { opacity: 0.14 }),
      shadowed(arch(x, y, width, height, gradient(180, ["#134030", "#0a2219"]), { stroke: stroke(gold, 1.2) }), "lifted", "#000000"),
      arch(x + 10, y + 10, width - 20, height - 20, { type: "none" }, { stroke: stroke(gold, 0.5) }),
      art("decoFan", { primary: night, secondary: gold }, W / 2 - 60, 92, 120, 65),
      box("diamond", x - 6, H - y - 6, 12, 12, foil("gold", 135)),
      box("diamond", W - x - 6, H - y - 6, 12, 12, foil("gold", 135)),
      centredText(page, 172, 20, t("studio.tpl.youAreInvited"), { font: FONTS.raleway, size: 11, bold: true, color: gold, spacing: 4, upper: true, shrink: true, inset: 88 }),
      centredText(page, 196, 104, t("studio.tpl.dinnerTitle"), { font: FONTS.playfair, size: 40, italic: true, color: "#ffffff", lineHeight: 1.05, shrink: true, valign: "middle", inset: 80 }),
      art("diamondDivider", colours, W / 2 - 80, 308, 160, 12),
      centredText(page, 332, 60, t("studio.tpl.dinnerLine"), { font: FONTS.raleway, size: 12.5, color: mist, lineHeight: 1.5, shrink: true, inset: 88 }),
      box("rect", W / 2 - 48, 406, 96, 1.4, foil("gold", 0)),
      centredText(page, 418, 22, t("studio.tpl.dinnerDate"), { font: FONTS.raleway, size: 13, bold: true, color: gold, spacing: 2, upper: true, shrink: true, inset: 76 }),
      centredText(page, 444, 40, t("studio.tpl.dinnerPlace"), { font: FONTS.raleway, size: 12.5, color: cream, lineHeight: 1.4, shrink: true, inset: 88 }),
      centredText(page, 500, 18, t("studio.tpl.dressCode"), { font: FONTS.raleway, size: 10, bold: true, color: "#a9bcb1", spacing: 2.5, upper: true, shrink: true, inset: 88 }),
    ]),
  ]);
}

function opening({ t }: TemplateContext) {
  const red = "#b91c1c";
  const deep = "#7f1d1d";
  const gold = "#d4a017";
  const ink = "#3f3f46";
  return design(t("studio.templates.items.opening"), [red, deep, gold, "#fffaf0"], [
    pageOf(SIZE, radial("#fffaf0", "#fbe8cf", { cy: 0.3, radius: 1 }), [
      art("sunburst", { primary: "#f6d9a8", secondary: gold }, -W * 0.3, -150, W * 1.6, 600, { opacity: 0.45 }),
      art("confetti", { primary: red, secondary: gold }, 20, 16, W - 40, 196, { opacity: 0.55 }),
      shadowed(art("starSeal", { primary: gold, secondary: "#fff7e0" }, W / 2 - 76, 40, 152, 152), "lifted"),
      box("ellipse", W / 2 - 48, 68, 96, 96, gradient(135, [red, deep]), { stroke: stroke("#f6d9a8", 1.2) }),
      text(W / 2 - 44, 94, 88, 44, t("studio.tpl.openingBadge"), { font: FONTS.oswald, size: 17, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1, shrink: true }),
      box("rect", 80, 228, W - 160, 36, solid(red)),
      shadowed(art("ribbonBanner", { primary: red, secondary: deep }, 20, 208, W - 40, 80), "soft"),
      text(76, 220, W - 152, 50, t("studio.tpl.grandOpening"), { font: FONTS.oswald, size: 30, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2.5, shrink: true }),
      centredText(page, 304, 44, t("studio.tpl.openingLine"), { font: FONTS.raleway, size: 13.5, color: ink, lineHeight: 1.4, shrink: true, inset: 56 }),
      shadowed(box("rect", 72, 364, W - 144, 92, solid("#ffffff"), { radius: 14 }), "soft", deep),
      box("rect", 72, 364, W - 144, 5, foil("gold", 0)),
      centredText(page, 380, 30, t("studio.tpl.openingDate"), { font: FONTS.oswald, size: 20, bold: true, color: red, shrink: true, valign: "middle", inset: 88 }),
      centredText(page, 414, 32, t("studio.tpl.openingPlace"), { font: FONTS.raleway, size: 12.5, color: ink, lineHeight: 1.35, shrink: true, valign: "middle", inset: 88 }),
      art("waves", { primary: red, secondary: gold }, 0, H - 104, W, 104),
    ]),
  ]);
}

function botanicalWedding({ t }: TemplateContext) {
  const terra = "#b4654a";
  const terraInk = "#8a4630";
  const sage = "#7d9a7e";
  const ink = "#3a2a24";
  const muted = "#6f5a50";
  const cream = "#fffaf5";
  const x = 44;
  const y = 64;
  const width = W - x * 2;
  const height = H - y - 44;
  const radius = width / 2;
  const cx = W / 2;
  const cy = y + radius;
  const leaves = { primary: sage, secondary: terra };
  const blooms = { primary: "#c98a6f", secondary: sage };
  const crown = [192, 207, 222, 237, 252, 288, 303, 318, 333, 348].map((angle, index) => {
    const radians = (angle * Math.PI) / 180;
    const left = angle < 270;
    return art("botanicalSprig", index % 3 === 1 ? blooms : leaves, cx + Math.cos(radians) * (radius + 2) - 18, cy + Math.sin(radians) * (radius + 2) - 36, 36, 72, { rotation: left ? angle + 180 : angle });
  });
  return design(t("studio.templates.items.botanicalWedding"), [terra, sage, cream, ink], [
    pageOf(SIZE, radial("#f9eee6", "#ecd5c7", { cy: 0.35, radius: 1 }), [
      art("blob", { primary: "#e9b9a4", secondary: "#f6ddd1" }, -90, -70, 250, 250, { opacity: 0.45 }),
      art("blob", { primary: "#c3d3bf", secondary: "#e6eee2" }, W - 150, H - 190, 260, 260, { opacity: 0.5, rotation: 120 }),
      shadowed(arch(x, y, width, height, solid(cream), { stroke: stroke(terra, 0.8) }), "lifted", terraInk),
      arch(x + 9, y + 9, width - 18, height - 18, { type: "none" }, { stroke: stroke(lighter(terra, 0.35), 0.5) }),
      ...crown,
      box("ellipse", cx - 5, y - 5, 10, 10, foil("rose", 135)),
      art("botanicalSprig", leaves, x - 12, y + height - 92, 44, 88, { rotation: -26 }),
      art("botanicalSprig", blooms, x + width - 32, y + height - 92, 44, 88, { rotation: 26 }),
      centredText(page, 170, 18, t("studio.tpl.togetherWithFamilies"), { font: FONTS.montserrat, size: 9, bold: true, color: muted, spacing: 2.5, upper: true, shrink: true, inset: 80 }),
      centredText(page, 194, 104, t("studio.tpl.coupleNames"), { font: FONTS.alexBrush, size: 52, color: terraInk, lineHeight: 1, shrink: true, valign: "middle", inset: 70 }),
      centredText(page, 302, 34, t("studio.tpl.botanicalWeddingLead"), { font: FONTS.montserrat, size: 11, color: muted, lineHeight: 1.4, shrink: true, inset: 84 }),
      rule(cx - 74, 352, 52, terra, 0.6),
      art("botanicalSprig", leaves, cx - 8, 336, 16, 32, { rotation: 90 }),
      rule(cx + 22, 352, 52, terra, 0.6),
      text(80, 368, cx - 94, 40, t("studio.tpl.weddingDate"), { font: FONTS.montserrat, size: 10.5, bold: true, color: ink, spacing: 0.5, upper: true, align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      vrule(cx, 368, 40, terra, 0.8),
      text(cx + 14, 368, cx - 94, 40, t("studio.tpl.weddingTime"), { font: FONTS.montserrat, size: 10.5, italic: true, color: ink, valign: "middle", lineHeight: 1.3, shrink: true }),
      centredText(page, 424, 40, t("studio.tpl.venue"), { font: FONTS.montserrat, size: 10.5, color: ink, lineHeight: 1.4, shrink: true, inset: 84 }),
      centredText(page, 482, 16, t("studio.tpl.rsvp"), { font: FONTS.montserrat, size: 8.5, bold: true, color: terraInk, spacing: 2, upper: true, shrink: true, inset: 96 }),
    ]),
  ]);
}

function goldGala({ t }: TemplateContext) {
  const night = "#0b0a08";
  const gold = "#d4af5a";
  const goldText = "#e9d08f";
  const cream = "#f2e8d0";
  const mist = "#bdb6a6";
  const onFoil = "#1a1306";
  const band = 250;
  const teeth = Array.from({ length: 21 }, (_, index) => box("triangle", index * 20, band - 1, 20, 12, solid("#a8843e"), { rotation: 180 }));
  return design(t("studio.templates.items.goldGala"), [night, gold, cream, mist], [
    pageOf(SIZE, radial("#1f1c17", night, { cy: 0.7, radius: 1 }), [
      art("halftone", { primary: "#3a3226", secondary: gold }, 0, band, W, H - band, { opacity: 0.3 }),
      box("rect", 0, 0, W, band, foil("gold", 160)),
      art("guillocheRosette", { primary: "#8a6a24", secondary: "#fff1c4" }, W / 2 - 140, -16, 280, 280, { opacity: 0.3 }),
      ...teeth,
      text(32, 52, W - 64, 16, t("studio.tpl.youAreInvited"), { font: FONTS.josefin, size: 10, bold: true, color: onFoil, spacing: 4, upper: true, align: "center", shrink: true }),
      text(28, 74, W - 56, 124, t("studio.tpl.goldGalaTitle"), { font: FONTS.abril, size: 54, color: onFoil, lineHeight: 1.05, align: "center", valign: "middle", shrink: true }),
      text(32, 200, W - 64, 18, "2027", { font: FONTS.josefin, size: 12, bold: true, color: onFoil, spacing: 8, align: "center" }),
      box("rect", 27, band + 30, 1.6, H - band - 72, foil("gold", 90)),
      box("rect", W - 28.6, band + 30, 1.6, H - band - 72, foil("gold", 90)),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 90, 290, 180, 12),
      centredText(page, 314, 40, t("studio.tpl.goldGalaLine"), { font: FONTS.josefin, size: 12.5, color: mist, lineHeight: 1.45, shrink: true, inset: 56 }),
      centredText(page, 366, 30, t("studio.tpl.dinnerDate"), { font: FONTS.abril, size: 20, color: goldText, lineHeight: 1.2, shrink: true, valign: "middle", inset: 40 }),
      centredText(page, 402, 40, t("studio.tpl.dinnerPlace"), { font: FONTS.josefin, size: 11.5, color: cream, lineHeight: 1.4, shrink: true, inset: 56 }),
      box("rect", W / 2 - 84, 462, 168, 30, { type: "none" }, { stroke: stroke(gold, 1), radius: 15 }),
      centredText(page, 462, 30, t("studio.tpl.goldGalaDress"), { font: FONTS.josefin, size: 10, bold: true, color: goldText, spacing: 3, upper: true, valign: "middle", shrink: true, inset: W / 2 - 76 }),
      centredText(page, 520, 16, t("studio.tpl.orgName"), { font: FONTS.josefin, size: 9, bold: true, color: mist, spacing: 3, upper: true, shrink: true, inset: 64 }),
      box("rect", 0, H - 8, W, 8, foil("gold", 0)),
    ]),
  ]);
}

function confettiBirthday({ t }: TemplateContext) {
  const coral = "#ff6f61";
  const coralDeep = "#e23c4b";
  const sun = "#ffc93c";
  const teal = "#1fb5a9";
  const navy = "#1d1a4b";
  const ink = "#24123a";
  const red = "#b4183a";
  const cream = "#fff8ef";
  const paper = lighter(cream, 0.25);
  const panel = 352;
  return design(t("studio.templates.items.confettiBirthday"), [coralDeep, sun, teal, navy], [
    pageOf(SIZE, solid(paper), [
      box("rect", 0, 0, W, panel, gradient(160, [coral, coralDeep])),
      art("sunburst", { primary: "#ff8577", secondary: sun }, -W * 0.3, -120, W * 1.6, 520, { opacity: 0.22 }),
      art("confetti", { primary: sun, secondary: "#ffffff" }, 8, 8, W - 16, 300, { opacity: 0.9 }),
      art("confetti", { primary: teal, secondary: navy }, 24, 40, W - 48, 260, { opacity: 0.55, rotation: 180 }),
      art("waves", { primary: cream, secondary: "#ffc2b4" }, 0, panel - 72, W, 96),
      box("rect", 0, panel - 14, W, 40, solid(paper)),
      text(24, 36, W - 48, 44, t("studio.tpl.letsCelebrate"), { font: FONTS.pacifico, size: 26, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.4, shrink: true, shadow: "subtle" }),
      text(0, 82, W, 216, "30", { font: FONTS.bebas, size: 230, color: "#ffffff", align: "center", valign: "middle", lineHeight: 0.92, shadow: { color: "#7f1028", x: 5, y: 6, opacity: 0.45 } }),
      text(32, 360, W - 64, 40, t("studio.tpl.confettiBirthdayName"), { font: FONTS.poppins, size: 22, bold: true, color: ink, align: "center", valign: "middle", lineHeight: 1.3, shrink: true }),
      shadowed(box("rect", 44, 414, W - 88, 116, solid("#ffffff"), { radius: 20, stroke: stroke("#ffd3c9", 1.2, "dashed") }), "lifted", coralDeep),
      box("rect", W / 2 - 36, 410, 20, 8, solid(sun), { radius: 4 }),
      box("rect", W / 2 - 10, 410, 20, 8, solid(coral), { radius: 4 }),
      box("rect", W / 2 + 16, 410, 20, 8, solid(teal), { radius: 4 }),
      text(64, 432, W - 128, 28, t("studio.tpl.confettiBirthdayDate"), { font: FONTS.poppins, size: 15, bold: true, color: red, align: "center", valign: "middle", lineHeight: 1.3, shrink: true }),
      text(64, 466, W - 128, 44, t("studio.tpl.confettiBirthdayPlace"), { font: FONTS.poppins, size: 11.5, color: "#4b5563", align: "center", lineHeight: 1.35, shrink: true }),
      text(48, 548, W - 96, 16, t("studio.tpl.rsvp"), { font: FONTS.poppins, size: 9.5, bold: true, color: navy, spacing: 2, upper: true, align: "center", shrink: true }),
      box("ellipse", W - 58, H - 72, 22, 22, solid(sun), { opacity: 0.85 }),
      box("ellipse", 28, H - 52, 14, 14, solid(teal), { opacity: 0.85 }),
      box("ellipse", W - 36, 376, 10, 10, solid(coral)),
      box("ellipse", 36, 384, 8, 8, solid(navy), { opacity: 0.8 }),
    ]),
  ]);
}

function watercolourShower({ t }: TemplateContext) {
  const washes = ["#f4b393", "#bba8e6", "#a3cb98", "#9fcbea"];
  const rose = "#a8566e";
  const ink = "#3d3a4b";
  const muted = "#5e5a6b";
  const sage = "#7f9c84";
  const cx = W / 2;
  const cy = 184;
  const wreath = Array.from({ length: 9 }, (_, index) => {
    const angle = (index / 9) * Math.PI * 2 - Math.PI / 2;
    const size = 104 + (index % 3) * 16;
    return art("blob", { primary: washes[index % 4], secondary: lighter(washes[(index + 1) % 4], 0.4) }, cx + Math.cos(angle) * 104 - size / 2, cy + Math.sin(angle) * 104 - size / 2, size, size, { opacity: 0.5, rotation: index * 40 });
  });
  const sprigs = [-140, -40, 30, 150].map((angle) => {
    const radians = (angle * Math.PI) / 180;
    return art("botanicalSprig", { primary: sage, secondary: "#c9a2b4" }, cx + Math.cos(radians) * 122 - 18, cy + Math.sin(radians) * 122 - 36, 36, 72, { rotation: angle + 90, opacity: 0.9 });
  });
  return design(t("studio.templates.items.watercolourShower"), [rose, ...washes, ink], [
    pageOf(SIZE, radial("#ffffff", "#fbf4ef", { cy: 0.35, radius: 1 }), [
      art("blob", { primary: "#f6c6a8", secondary: "#fde9dc" }, -80, H - 150, 200, 200, { opacity: 0.3 }),
      art("blob", { primary: "#cdbfe8", secondary: "#efe9fa" }, W - 110, H - 130, 180, 180, { opacity: 0.3, rotation: 70 }),
      ...wreath,
      ...sprigs,
      box("ellipse", cx - 84, cy - 84, 168, 168, solid("#fffdfb"), { opacity: 0.92 }),
      box("ellipse", cx - 74, cy - 74, 148, 148, { type: "none" }, { stroke: stroke("#cdbfe8", 1, "dotted") }),
      text(cx - 70, cy - 50, 140, 100, t("studio.tpl.watercolourShowerTitle"), { font: FONTS.parisienne, size: 42, color: rose, align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
      centredText(page, 344, 22, t("studio.tpl.watercolourShowerLine"), { font: FONTS.raleway, size: 12, italic: true, color: muted, lineHeight: 1.3, shrink: true, inset: 60 }),
      centredText(page, 372, 34, t("studio.tpl.babyShowerFor"), { font: FONTS.raleway, size: 11, color: muted, lineHeight: 1.35, shrink: true, inset: 64 }),
      centredText(page, 408, 50, t("studio.tpl.parentName"), { font: FONTS.parisienne, size: 38, color: ink, lineHeight: 1.2, valign: "middle", shrink: true, inset: 48 }),
      art("brushStroke", { primary: "#f6c6a8", secondary: "#fbe0cf" }, cx - 120, 466, 240, 36, { opacity: 0.75 }),
      centredText(page, 470, 28, t("studio.tpl.showerDate"), { font: FONTS.raleway, size: 12.5, bold: true, color: ink, lineHeight: 1.3, valign: "middle", shrink: true, inset: 90 }),
      centredText(page, 506, 36, t("studio.tpl.showerPlace"), { font: FONTS.raleway, size: 10.5, color: muted, lineHeight: 1.35, shrink: true, inset: 72 }),
      centredText(page, 556, 14, t("studio.tpl.rsvp"), { font: FONTS.raleway, size: 8.5, bold: true, color: rose, spacing: 2, upper: true, lineHeight: 1.3, shrink: true, inset: 96 }),
    ]),
  ]);
}

function decoParty({ t }: TemplateContext) {
  const black = "#0e0608";
  const oxblood = "#4a1220";
  const gold = "#cfa85a";
  const champagne = "#ecd5a3";
  const blush = "#f0d9c8";
  const mist = "#d8c2b4";
  const onFoil = "#2a0a10";
  return design(t("studio.templates.items.decoParty"), [oxblood, gold, black, champagne], [
    pageOf(SIZE, gradient(180, [oxblood, "#14070a"]), [
      art("sunburst", { primary: "#6a1a2c", secondary: gold }, -W * 0.35, H - 300, W * 1.7, 600, { opacity: 0.4 }),
      frame("decoFrame", { primary: gold, secondary: gold }, page),
      centredText(page, 58, 16, t("studio.tpl.youAreInvited"), { font: FONTS.raleway, size: 10, bold: true, color: champagne, spacing: 5, upper: true, shrink: true, inset: 60 }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 70, 82, 140, 10),
      centredText(page, 96, 156, t("studio.tpl.decoPartyTitle"), { font: FONTS.bebas, size: 88, color: champagne, spacing: 3, lineHeight: 0.88, valign: "middle", shrink: true, inset: 44, shadow: "deep" }),
      centredText(page, 256, 36, t("studio.tpl.decoPartyLine"), { font: FONTS.raleway, size: 13, italic: true, color: blush, lineHeight: 1.4, shrink: true, inset: 64 }),
      shadowed(box("rect", W / 2 - 128, 302, 256, 34, foil("gold", 0), { radius: 17 }), "soft", "#000000"),
      centredText(page, 302, 34, t("studio.tpl.decoPartyDate"), { font: FONTS.raleway, size: 12, bold: true, color: onFoil, lineHeight: 1.3, valign: "middle", shrink: true, inset: W / 2 - 120 }),
      centredText(page, 346, 40, t("studio.tpl.decoPartyPlace"), { font: FONTS.raleway, size: 11.5, color: mist, lineHeight: 1.4, shrink: true, inset: 64 }),
      centredText(page, 392, 16, t("studio.tpl.decoPartyDress"), { font: FONTS.raleway, size: 9.5, bold: true, color: champagne, spacing: 2, upper: true, lineHeight: 1.3, shrink: true, inset: 64 }),
      shadowed(art("decoFan", { primary: black, secondary: gold }, W / 2 - 150, H - 200, 300, 162), "glow", gold),
    ]),
  ]);
}

export const INVITATION_TEMPLATES: StudioTemplate[] = [
  { id: "wedding", category: "invitations", size: SIZE, build: wedding },
  { id: "birthday", category: "invitations", size: SIZE, build: birthday },
  { id: "party", category: "invitations", size: SIZE, build: party },
  { id: "babyShower", category: "invitations", size: SIZE, build: babyShower },
  { id: "graduation", category: "invitations", size: SIZE, build: graduation },
  { id: "corporateEvent", category: "invitations", size: SIZE, build: corporate },
  { id: "dinner", category: "invitations", size: SIZE, build: dinner },
  { id: "opening", category: "invitations", size: SIZE, build: opening },
  { id: "botanicalWedding", category: "invitations", size: SIZE, build: botanicalWedding },
  { id: "goldGala", category: "invitations", size: SIZE, build: goldGala },
  { id: "confettiBirthday", category: "invitations", size: SIZE, build: confettiBirthday },
  { id: "watercolourShower", category: "invitations", size: SIZE, build: watercolourShower },
  { id: "decoParty", category: "invitations", size: SIZE, build: decoParty },
];
