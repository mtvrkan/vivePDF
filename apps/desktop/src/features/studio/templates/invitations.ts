import type { StudioElement, StudioFill } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, type StudioTemplate, type TemplateContext } from "./kit";
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

export const INVITATION_TEMPLATES: StudioTemplate[] = [
  { id: "wedding", category: "invitations", size: SIZE, build: wedding },
  { id: "birthday", category: "invitations", size: SIZE, build: birthday },
  { id: "party", category: "invitations", size: SIZE, build: party },
  { id: "babyShower", category: "invitations", size: SIZE, build: babyShower },
  { id: "graduation", category: "invitations", size: SIZE, build: graduation },
  { id: "corporateEvent", category: "invitations", size: SIZE, build: corporate },
  { id: "dinner", category: "invitations", size: SIZE, build: dinner },
  { id: "opening", category: "invitations", size: SIZE, build: opening },
];
