import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList, type Palette } from "./palettes";

const SIZE = "a4Landscape" as const;
const { width: W, height: H } = sizeOf(SIZE);
const PAGE = { width: W, height: H };

type Wording = { title: string; subtitle: string; lead: string; body: string; left: string; right: string };

const QUALIFIER_FIRST = new Set(["tr"]);

function titleLines({ t, language }: TemplateContext, words: Wording): [string, string] {
  const certificate = t("studio.tpl.certificate");
  const qualifier = t(words.subtitle);
  return QUALIFIER_FIRST.has(language) ? [qualifier, certificate] : [certificate, qualifier];
}

function goldInk(palette: Palette, large = true): string {
  return darker(palette.accent2, large ? 0.38 : 0.5);
}

function signature(x: number, y: number, label: string, value: string, color: string, font: string, lineColor: string, width = 200): StudioElement[] {
  return [
    text(x, y - 26, width, 22, value, { font, size: 13, color, align: "center", valign: "bottom", shrink: true }),
    rule(x, y, width, lineColor, 0.8),
    text(x, y + 6, width, 18, label, { font, size: 10, color, align: "center", spacing: 1.5, upper: true, shrink: true }),
  ];
}

function classic(context: TemplateContext, words: Wording, palette: Palette, frameId: "guillocheBorder" | "nouveauFrame", seal: string) {
  const { t } = context;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  const [heading, subtitle] = titleLines(context, words);
  return design(t(words.title), paletteList(palette), [
    pageOf(SIZE, radial(palette.paper, palette.soft, { cy: 0.38, radius: 0.95 }), [
      frame(frameId, colours, PAGE),
      centredText(PAGE, 72, 18, t("studio.tpl.orgName"), { font: FONTS.cinzel, size: 11, color: palette.muted, spacing: 4, shrink: true }),
      centredText(PAGE, 94, 60, heading, { font: FONTS.cinzel, size: 46, bold: true, color: palette.accent, spacing: 6, upper: true, shrink: true }),
      centredText(PAGE, 152, 48, subtitle, { font: FONTS.greatVibes, size: 36, color: goldInk(palette), shrink: true }),
      art("diamondDivider", { primary: palette.accent2, secondary: palette.accent2 }, W / 2 - 110, 204, 220, 14),
      centredText(PAGE, 226, 22, t(words.lead), { font: FONTS.garamond, size: 15, italic: true, color: palette.muted, shrink: true }),
      centredText(PAGE, 250, 72, t("studio.tpl.recipientName"), { font: FONTS.greatVibes, size: 56, color: palette.ink, shrink: true, valign: "middle" }),
      box("rect", W * 0.3, 324, W * 0.4, 1.6, foil("gold", 0)),
      centredText(PAGE, 336, 50, t(words.body), { font: FONTS.garamond, size: 14, color: palette.muted, lineHeight: 1.4, inset: W * 0.2, shrink: true }),
      shadowed(art("waxSeal", { primary: seal, secondary: palette.accent2 }, W / 2 - 44, 398, 88, 88), "soft"),
      ...signature(110, 486, t(words.left), "{date}", palette.ink, FONTS.garamond, palette.accent2),
      ...signature(W - 310, 486, t(words.right), "", palette.ink, FONTS.garamond, palette.accent2),
    ]),
  ]);
}

function band(context: TemplateContext, words: Wording, palette: Palette, emblem: "laurel" | "shield" | "arcRings", pattern: "topographic" | "halftone" | "diagonalHatch" | "honeycomb") {
  const { t } = context;
  const panel = 220;
  const left = 280;
  const content = W - left - 70;
  const white = { primary: "#ffffff", secondary: palette.accent2 };
  const [heading, subtitle] = titleLines(context, words);
  const emblemArt = emblem === "shield" ? art("shield", white, panel / 2 - 48, 140, 96, 120) : emblem === "laurel" ? art("laurel", white, panel / 2 - 70, 150, 140, 134) : art("arcRings", white, panel / 2 - 70, 140, 140, 140);
  return design(t(words.title), paletteList(palette), [
    pageOf(SIZE, solid(palette.paper), [
      box("rect", 0, 0, panel, H, gradient(165, [palette.accent, darker(palette.accent, 0.45)])),
      art(pattern, { primary: "#ffffff", secondary: palette.accent2 }, 0, 0, panel, H, { opacity: 0.55 }),
      box("rect", panel, 0, 5, H, foil("gold", 90)),
      emblemArt,
      text(20, 330, panel - 40, 40, "2026", { font: FONTS.montserrat, size: 30, bold: true, color: "#ffffff", align: "center", spacing: 3 }),
      rule(panel / 2 - 24, 384, 48, palette.accent2, 1.2),
      art("ribbonCorner", { primary: palette.accent, secondary: palette.accent2 }, W - 150, 0, 150, 150, { rotation: 90 }),
      text(left, 86, content, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 11, bold: true, color: palette.accent, spacing: 3, upper: true, shrink: true }),
      text(left, 110, content, 56, heading, { font: FONTS.montserrat, size: 44, bold: true, color: palette.ink, spacing: 3, upper: true, shrink: true }),
      text(left, 166, content, 28, subtitle, { font: FONTS.montserrat, size: 17, color: palette.accent, spacing: 6, upper: true, shrink: true }),
      text(left, 226, content, 22, t(words.lead), { font: FONTS.inter, size: 13, color: palette.muted, shrink: true }),
      text(left, 250, content, 64, t("studio.tpl.recipientName"), { font: FONTS.playfair, size: 44, bold: true, color: palette.ink, shrink: true, valign: "middle" }),
      box("rect", left, 322, content * 0.62, 2.5, foil("gold", 0)),
      text(left, 340, content * 0.9, 64, t(words.body), { font: FONTS.inter, size: 13, color: palette.muted, lineHeight: 1.5, shrink: true }),
      ...signature(left, 488, t(words.left), "{date}", palette.ink, FONTS.inter, lighter(palette.muted, 0.35)),
      ...signature(left + 270, 488, t(words.right), "", palette.ink, FONTS.inter, lighter(palette.muted, 0.35)),
    ]),
  ]);
}

function ornate(context: TemplateContext, words: Wording, palette: Palette, frameId: "nouveauFrame" | "gemFrame") {
  const { t } = context;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  const sprig = { primary: palette.accent, secondary: palette.accent2 };
  return design(t(words.title), paletteList(palette), [
    pageOf(SIZE, radial(palette.paper, palette.soft, { cy: 0.45, radius: 0.9 }), [
      frame(frameId, colours, PAGE),
      centredText(PAGE, 86, 74, t(words.subtitle), { font: FONTS.parisienne, size: 56, color: palette.accent, shrink: true }),
      centredText(PAGE, 162, 22, t("studio.tpl.certificate"), { font: FONTS.cormorant, size: 15, bold: true, color: goldInk(palette, false), spacing: 8, upper: true, shrink: true }),
      art("flourishDivider", colours, W / 2 - 120, 190, 240, 32),
      centredText(PAGE, 234, 24, t(words.lead), { font: FONTS.cormorant, size: 17, italic: true, color: palette.muted, shrink: true }),
      art("botanicalSprig", sprig, 128, 240, 54, 108, { rotation: -24, opacity: 0.9 }),
      art("botanicalSprig", sprig, W - 182, 240, 54, 108, { rotation: 24, opacity: 0.9 }),
      centredText(PAGE, 262, 70, t("studio.tpl.recipientName"), { font: FONTS.cormorant, size: 50, bold: true, color: palette.ink, shrink: true, valign: "middle", inset: 200 }),
      box("rect", W * 0.34, 334, W * 0.32, 1.2, foil("gold", 0)),
      centredText(PAGE, 344, 54, t(words.body), { font: FONTS.cormorant, size: 16, color: palette.muted, lineHeight: 1.35, inset: W * 0.22, shrink: true }),
      art("laurel", colours, W / 2 - 42, 408, 84, 80),
      ...signature(120, 488, t(words.left), "{date}", palette.ink, FONTS.cormorant, palette.accent2),
      ...signature(W - 320, 488, t(words.right), "", palette.ink, FONTS.cormorant, palette.accent2),
    ]),
  ]);
}

function deco(context: TemplateContext, words: Wording) {
  const { t } = context;
  const night = "#0d1324";
  const gold = "#d6b25e";
  const colours = { primary: gold, secondary: gold };
  return design(t(words.title), [gold, night, "#f8f1df"], [
    pageOf(SIZE, radial("#1c2747", night, { cy: 0.36, radius: 1 }), [
      art("sunburst", { primary: "#3a4a78", secondary: gold }, 0, 0, W, H, { opacity: 0.18 }),
      frame("decoFrame", colours, PAGE),
      art("decoFan", { primary: night, secondary: gold }, W / 2 - 64, 58, 128, 70),
      centredText(PAGE, 140, 64, t(words.subtitle), { font: FONTS.cinzel, size: 46, bold: true, color: gold, spacing: 8, upper: true, shrink: true }),
      art("diamondDivider", colours, W / 2 - 150, 210, 300, 18),
      centredText(PAGE, 244, 22, t(words.lead), { font: FONTS.raleway, size: 14, color: "#e5e7eb", spacing: 1, shrink: true }),
      centredText(PAGE, 270, 66, t("studio.tpl.recipientName"), { font: FONTS.playfair, size: 46, italic: true, color: "#ffffff", shrink: true, valign: "middle" }),
      box("rect", W * 0.33, 342, W * 0.34, 1.4, foil("gold", 0)),
      centredText(PAGE, 354, 50, t(words.body), { font: FONTS.raleway, size: 13, color: "#cbd5e1", lineHeight: 1.5, inset: W * 0.2, shrink: true }),
      ...signature(130, 488, t(words.left), "{date}", "#e5e7eb", FONTS.raleway, gold),
      ...signature(W - 330, 488, t(words.right), "", "#e5e7eb", FONTS.raleway, gold),
    ]),
  ]);
}

function spotlight(context: TemplateContext, words: Wording, palette: Palette) {
  const { t } = context;
  const colours = { primary: palette.accent, secondary: palette.accent2 };
  return design(t(words.title), paletteList(palette), [
    pageOf(SIZE, solid(palette.paper), [
      art("halftone", colours, 0, 0, W, H, { opacity: 0.45 }),
      frame("gemFrame", colours, PAGE),
      shadowed(art("starSeal", colours, W - 200, 66, 120, 120), "lifted"),
      box("ellipse", W - 182, 84, 84, 84, solid(palette.accent)),
      text(W - 188, 100, 96, 52, t("studio.tpl.monthBadge"), { font: FONTS.oswald, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1, shrink: true }),
      text(90, 92, 520, 70, t(words.subtitle), { font: FONTS.oswald, size: 50, bold: true, color: palette.accent, upper: true, spacing: 2, shrink: true }),
      text(90, 166, 520, 22, t(words.lead), { font: FONTS.lora, size: 15, italic: true, color: palette.muted, shrink: true }),
      text(90, 212, 600, 80, t("studio.tpl.recipientName"), { font: FONTS.lora, size: 56, bold: true, color: palette.ink, shrink: true, valign: "middle" }),
      box("rect", 90, 302, 110, 5, foil("gold", 0)),
      text(90, 328, 560, 70, t(words.body), { font: FONTS.lora, size: 15, color: palette.muted, lineHeight: 1.5, shrink: true }),
      ...signature(90, 486, t(words.left), "{date}", palette.ink, FONTS.lora, palette.accent2),
      ...signature(370, 486, t(words.right), "", palette.ink, FONTS.lora, palette.accent2),
    ]),
  ]);
}

function playful(context: TemplateContext, words: Wording) {
  const { t } = context;
  const pink = "#db2777";
  const violet = "#6d28d9";
  const sun = "#f59e0b";
  return design(t(words.title), [violet, pink, sun, "#ffffff"], [
    pageOf(SIZE, gradient(160, ["#fdf2f8", "#f5f3ff", "#ecfeff"]), [
      art("blob", { primary: pink, secondary: violet }, -60, -70, 260, 260, { opacity: 0.8 }),
      art("blob", { primary: sun, secondary: pink }, W - 210, H - 220, 280, 280, { opacity: 0.75, rotation: 140 }),
      art("confetti", { primary: violet, secondary: sun }, 120, 40, 600, 400, { opacity: 0.5 }),
      shadowed(box("rect", 150, 90, W - 300, H - 180, solid("#ffffff"), { radius: 36, stroke: { color: violet, width: 2.5, dash: "dashed" } }), "lifted", violet),
      centredText(PAGE, 116, 70, t(words.subtitle), { font: FONTS.pacifico, size: 46, color: violet, shrink: true, inset: 190 }),
      centredText(PAGE, 192, 24, t(words.lead), { font: FONTS.nunito, size: 16, bold: true, color: "#4b5563", shrink: true, inset: 190 }),
      centredText(PAGE, 222, 70, t("studio.tpl.kidName"), { font: FONTS.caveat, size: 60, bold: true, color: pink, shrink: true, inset: 190, valign: "middle" }),
      centredText(PAGE, 298, 60, t(words.body), { font: FONTS.nunito, size: 16, color: "#374151", lineHeight: 1.4, inset: 210, shrink: true }),
      shadowed(art("starSeal", { primary: sun, secondary: "#ffffff" }, W / 2 - 38, 366, 76, 76), "soft"),
      ...signature(200, 472, t(words.left), "{date}", "#374151", FONTS.nunito, violet),
      ...signature(W - 400, 472, t(words.right), "", "#374151", FONTS.nunito, violet),
    ]),
  ]);
}

function voucher(context: TemplateContext) {
  const { t } = context;
  const wine = "#2b0f17";
  const cream = "#f6e7d6";
  const left = 64;
  const stubX = W - 270;
  const top = 118;
  const height = 360;
  const stubWidth = W - 40 - stubX;
  return design(t("studio.templates.items.giftVoucher"), [wine, "#c98576", cream, "#ffffff"], [
    pageOf(SIZE, radial("#fbf6f1", "#efe3d8", { cy: 0.4 }), [
      shadowed(box("rect", 40, top, W - 80, height, gradient(135, ["#3d1421", wine]), { radius: 20 }), "lifted"),
      box("rect", stubX, top, stubWidth, height, foil("rose", 160), { radius: 20 }),
      box("rect", stubX, top, 24, height, foil("rose", 160)),
      vrule(stubX, top + 20, height - 40, cream, 1.4, "dashed"),
      art("botanicalSprig", { primary: "#c98576", secondary: cream }, stubX - 92, top + 18, 60, 120, { rotation: 32, opacity: 0.55 }),
      text(left + 16, top + 40, stubX - left - 60, 18, t("studio.tpl.giftVoucher"), { font: FONTS.inter, size: 12, bold: true, color: "#e8c9a0", upper: true, spacing: 4, shrink: true }),
      rule(left + 16, top + 68, 60, "#e8c9a0", 1),
      text(left + 16, top + 86, stubX - left - 60, 24, t("studio.tpl.voucherLead"), { font: FONTS.playfair, size: 17, italic: true, color: cream, shrink: true }),
      text(left + 16, top + 116, stubX - left - 90, 92, t("studio.tpl.voucherService"), { font: FONTS.playfair, size: 38, bold: true, color: "#ffffff", lineHeight: 1.12, shrink: true }),
      text(left + 16, top + 244, 260, 18, t("studio.tpl.voucherFrom"), { font: FONTS.inter, size: 12, color: cream }),
      rule(left + 16, top + 286, 240, "#e8c9a0", 0.8),
      text(left + 16, top + 306, stubX - left - 60, 18, t("studio.tpl.validUntil"), { font: FONTS.inter, size: 11, color: cream, shrink: true }),
      text(stubX + 30, top + 62, stubWidth - 50, 20, t("studio.tpl.voucherValueLabel"), { font: FONTS.inter, size: 12, bold: true, color: wine, align: "center", spacing: 4, upper: true, shrink: true }),
      text(stubX + 30, top + 92, stubWidth - 50, 84, t("studio.tpl.voucherAmount"), { font: FONTS.playfair, size: 56, bold: true, color: wine, align: "center", valign: "middle", shrink: true }),
      rule(stubX + 30 + (stubWidth - 50) / 2 - 30, top + 196, 60, wine, 1),
      text(stubX + 30, top + 222, stubWidth - 50, 18, t("studio.tpl.code"), { font: FONTS.inter, size: 11, bold: true, color: wine, align: "center", spacing: 4, upper: true }),
      text(stubX + 30, top + 244, stubWidth - 50, 30, "VP-{n}", { font: FONTS.oswald, size: 24, bold: true, color: wine, align: "center", spacing: 3 }),
    ]),
  ]);
}

function foilExcellence(context: TemplateContext, words: Wording) {
  const { t } = context;
  const deep = "#05221a";
  const emerald = "#0b3b2e";
  const gold = "#d9b968";
  const goldText = "#e8cf8f";
  const mist = "#c9d8cf";
  const cream = "#f3ead2";
  const ribbon = 164;
  const left = 312;
  const content = W - left - 88;
  const edge = (x: number, y: number, width: number, height: number) => box("rect", x, y, width, height, foil("gold", width > height ? 0 : 90));
  return design(t(words.title), [emerald, gold, deep, cream], [
    pageOf(SIZE, radial("#15563f", deep, { cx: 0.62, cy: 0.4, radius: 1.1 }), [
      art("marble", { primary: "#1f6b52", secondary: gold }, 0, 0, W, H, { opacity: 0.16 }),
      edge(28, 28, W - 56, 2.5),
      edge(28, H - 30.5, W - 56, 2.5),
      edge(28, 28, 2.5, H - 56),
      edge(W - 30.5, 28, 2.5, H - 56),
      box("rect", 38, 38, W - 76, H - 76, { type: "none" }, { stroke: stroke(gold, 0.5) }),
      art("guillocheRosette", { primary: gold, secondary: "#2a7a5e" }, W - 236, 56, 176, 176, { opacity: 0.2 }),
      shadowed(box("rect", ribbon - 36, 0, 72, 236, foil("gold", 90)), "long", "#000000"),
      box("rect", ribbon - 27, 0, 2, 226, solid("#8a6a24"), { opacity: 0.45 }),
      box("rect", ribbon + 25, 0, 2, 226, solid("#8a6a24"), { opacity: 0.45 }),
      shadowed(art("ribbonSeal", { primary: "#c9a24a", secondary: "#fff3cf" }, ribbon - 92, 170, 184, 230), "lifted", "#000000"),
      box("ellipse", ribbon - 58, 204, 116, 116, foil("gold", 135), { stroke: stroke("#fff3cf", 0.8) }),
      art("laurel", { primary: emerald, secondary: emerald }, ribbon - 50, 214, 100, 96),
      text(ribbon - 40, 248, 80, 28, "2026", { font: FONTS.montserrat, size: 18, bold: true, color: emerald, align: "center", valign: "middle", spacing: 1.5, lineHeight: 1.2 }),
      text(left, 84, content, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: goldText, spacing: 4, upper: true, shrink: true }),
      box("rect", left, 112, 48, 2, foil("gold", 0)),
      text(left, 124, content, 76, t(words.subtitle), { font: FONTS.abril, size: 54, color: goldText, lineHeight: 1.15, shrink: true, valign: "middle", shadow: "deep" }),
      text(left, 212, content, 24, t(words.lead), { font: FONTS.cormorant, size: 17, italic: true, color: mist, shrink: true }),
      text(left, 240, content, 72, t("studio.tpl.recipientName"), { font: FONTS.cormorant, size: 54, bold: true, italic: true, color: "#ffffff", lineHeight: 1.15, shrink: true, valign: "middle" }),
      box("rect", left, 320, content * 0.6, 1.6, foil("gold", 0)),
      text(left, 338, content * 0.92, 60, t(words.body), { font: FONTS.montserrat, size: 11.5, color: mist, lineHeight: 1.6, shrink: true }),
      ...signature(left, 486, t(words.left), "{date}", cream, FONTS.montserrat, gold),
      ...signature(left + 250, 486, t(words.right), "", cream, FONTS.montserrat, gold),
    ]),
  ]);
}

function modernAward(context: TemplateContext, words: Wording) {
  const { t } = context;
  const ink = "#16181d";
  const coral = "#ff5a3c";
  const coralInk = "#c2361b";
  const muted = "#5f666d";
  const line = "#d6d3cc";
  const x = 72;
  const column = (W - x * 2) / 3;
  const label = (index: number, value: string) => text(x + column * index + (index ? 20 : 0), 500, column - 28, 16, value, { font: FONTS.inter, size: 9, bold: true, color: muted, spacing: 2, upper: true, shrink: true });
  const value = (index: number, content: string) => text(x + column * index + (index ? 20 : 0), 520, column - 28, 24, content, { font: FONTS.montserrat, size: 15, bold: true, color: ink, shrink: true, valign: "middle" });
  return design(t(words.title), [ink, coral, "#fafaf7", muted], [
    pageOf(SIZE, solid("#fafaf7"), [
      box("ellipse", W - 300, -150, 470, 470, gradient(140, ["#ff8a65", coral, "#e8432a"])),
      art("arcRings", { primary: "#ffffff", secondary: "#ffd9cc" }, W - 262, -112, 394, 394, { opacity: 0.45 }),
      box("ellipse", W - 132, 344, 28, 28, solid(ink)),
      box("ellipse", W - 176, 352, 12, 12, solid(coral)),
      text(x, 64, 380, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: ink, spacing: 3, upper: true, shrink: true }),
      text(W - x - 120, 64, 120, 18, "2026", { font: FONTS.montserrat, size: 10.5, bold: true, color: ink, spacing: 3, align: "right" }),
      rule(x, 100, W - x * 2, ink, 1),
      box("rect", x, 134, 12, 12, solid(coral)),
      text(x + 24, 130, 420, 20, t(words.subtitle), { font: FONTS.inter, size: 11, bold: true, color: coralInk, spacing: 3, upper: true, shrink: true, valign: "middle" }),
      text(x - 4, 156, 520, 120, t("studio.tpl.modernAwardTitle"), { font: FONTS.montserrat, size: 104, bold: true, color: ink, lineHeight: 1.1, shrink: true, valign: "middle" }),
      text(x, 290, 440, 20, t(words.lead), { font: FONTS.inter, size: 12.5, color: muted, shrink: true }),
      text(x, 314, 600, 66, t("studio.tpl.recipientName"), { font: FONTS.montserrat, size: 44, color: ink, lineHeight: 1.2, shrink: true, valign: "middle" }),
      box("rect", x, 390, 64, 4, solid(coral)),
      text(x, 410, 480, 58, t(words.body), { font: FONTS.inter, size: 12, color: muted, lineHeight: 1.55, shrink: true }),
      rule(x, 484, W - x * 2, ink, 1),
      vrule(x + column, 496, 56, line, 1),
      vrule(x + column * 2, 496, 56, line, 1),
      label(0, t(words.left)),
      value(0, "{date}"),
      label(1, t(words.right)),
      rule(x + column + 20, 546, column - 48, muted, 0.8),
      label(2, t("studio.tpl.code")),
      value(2, "VP-{n}"),
    ]),
  ]);
}

function botanicalAppreciation(context: TemplateContext, words: Wording) {
  const { t } = context;
  const sage = "#7f9c84";
  const sageInk = "#3f5a46";
  const rose = "#c98b8b";
  const roseInk = "#8c4a52";
  const ink = "#2f2a2a";
  const muted = "#6b5f5c";
  const leaves = { primary: sage, secondary: rose };
  const blooms = { primary: rose, secondary: sage };
  const cx = 150;
  const cy = H / 2;
  const x0 = 372;
  const width = W - x0 - 56;
  const [heading, subtitle] = titleLines(context, words);
  const wreath = Array.from({ length: 12 }, (_, index) => {
    const angle = index * 30;
    const radians = (angle * Math.PI) / 180;
    return art("botanicalSprig", index % 3 === 1 ? blooms : leaves, cx + Math.cos(radians) * 104 - 21, cy + Math.sin(radians) * 104 - 42, 42, 84, { rotation: angle + 180 });
  });
  return design(t(words.title), [sageInk, rose, "#fbf6f1", ink], [
    pageOf(SIZE, radial("#fffcf8", "#f6eee6", { cx: 0.7, cy: 0.45, radius: 1 }), [
      box("ellipse", -300, -90, 640, H + 180, gradient(160, ["#f4e2da", "#e8dccd"])),
      art("blob", { primary: "#e8c4b8", secondary: "#f6e6df" }, -70, -60, 270, 270, { opacity: 0.55 }),
      art("blob", { primary: "#c5d6c2", secondary: "#e7efe4" }, 40, H - 240, 280, 280, { opacity: 0.55, rotation: 90 }),
      ...wreath,
      shadowed(box("ellipse", cx - 86, cy - 86, 172, 172, solid("#fffdfa"), { stroke: stroke(sage, 0.8) }), "soft"),
      box("ellipse", cx - 76, cy - 76, 152, 152, { type: "none" }, { stroke: stroke(rose, 0.8, "dotted") }),
      text(cx - 68, cy - 40, 136, 80, t("studio.tpl.thankYou"), { font: FONTS.allura, size: 44, color: roseInk, align: "center", valign: "middle", lineHeight: 1, shrink: true }),
      art("botanicalSprig", leaves, W - 96, 40, 44, 88, { rotation: 28, opacity: 0.5 }),
      text(x0, 70, width, 18, t("studio.tpl.orgName"), { font: FONTS.lora, size: 10.5, bold: true, color: muted, spacing: 3, upper: true, align: "center", shrink: true }),
      text(x0, 100, width, 28, `${heading} ${subtitle}`, { font: FONTS.lora, size: 17, bold: true, color: sageInk, spacing: 4, upper: true, align: "center", shrink: true, valign: "middle" }),
      rule(x0 + width / 2 - 100, 152, 72, sage, 0.8),
      art("botanicalSprig", leaves, x0 + width / 2 - 9, 134, 18, 36, { rotation: 90 }),
      rule(x0 + width / 2 + 28, 152, 72, sage, 0.8),
      text(x0, 172, width, 22, t(words.lead), { font: FONTS.lora, size: 14, italic: true, color: muted, align: "center", shrink: true }),
      text(x0, 200, width, 92, t("studio.tpl.recipientName"), { font: FONTS.allura, size: 68, color: ink, align: "center", valign: "middle", lineHeight: 1.2, shrink: true }),
      rule(x0 + width / 2 - 110, 302, 220, rose, 0.8),
      text(x0 + 20, 320, width - 40, 72, t(words.body), { font: FONTS.lora, size: 13, color: muted, lineHeight: 1.55, align: "center", shrink: true }),
      ...signature(x0 + 10, 486, t(words.left), "{date}", ink, FONTS.lora, sage, 170),
      ...signature(x0 + width - 180, 486, t(words.right), "", ink, FONTS.lora, sage, 170),
    ]),
  ]);
}

function decoHonour(context: TemplateContext, words: Wording) {
  const { t } = context;
  const ink = "#090c0c";
  const jadeDeep = "#072421";
  const gold = "#d4b46a";
  const goldText = "#e6cf94";
  const cream = "#f4ecd8";
  const mist = "#b9cbc6";
  const cx = W / 2;
  const bottom = H - 40;
  const tier = (width: number, top: number) => box("rect", cx - width / 2, top, width, bottom - top, gradient(180, ["#14514a", jadeDeep]), { stroke: stroke(gold, 1) });
  const stripes = (from: number, direction: number) => [0, 1, 2, 3, 4].map((index) => ({ ...vrule(from + direction * index * 9, 48, H - 96, gold, 0.6), opacity: 0.5 }));
  const studs = [150, 200, 250].flatMap((half, index) => [box("diamond", cx - half - 6, 40 + index * 34 - 6, 12, 12, foil("gold", 135)), box("diamond", cx + half - 6, 40 + index * 34 - 6, 12, 12, foil("gold", 135))]);
  return design(t(words.title), [jadeDeep, gold, ink, cream], [
    pageOf(SIZE, gradient(180, ["#141a19", ink]), [
      art("diagonalHatch", { primary: "#1d2a28", secondary: gold }, 0, 0, W, H, { opacity: 0.22 }),
      box("rect", 20, 20, W - 40, H - 40, { type: "none" }, { stroke: stroke(gold, 0.8) }),
      ...stripes(64, 1),
      ...stripes(W - 64, -1),
      shadowed(tier(300, 40), "lifted", "#000000"),
      tier(400, 74),
      tier(500, 108),
      art("sunburst", { primary: "#1b6157", secondary: "#1f6a5f" }, cx - 250, 108, 500, bottom - 108, { opacity: 0.2 }),
      box("rect", cx - 238, 120, 476, bottom - 132, { type: "none" }, { stroke: stroke(gold, 0.5) }),
      ...studs,
      art("decoFan", { primary: jadeDeep, secondary: gold }, cx - 60, 46, 120, 65),
      text(cx - 220, 136, 440, 16, t("studio.tpl.orgName"), { font: FONTS.josefin, size: 10, bold: true, color: goldText, spacing: 5, upper: true, align: "center", shrink: true }),
      text(cx - 220, 156, 440, 54, t(words.subtitle), { font: FONTS.josefin, size: 36, bold: true, color: goldText, spacing: 4, upper: true, align: "center", valign: "middle", lineHeight: 1.2, shrink: true }),
      art("diamondDivider", { primary: gold, secondary: gold }, cx - 120, 216, 240, 16),
      text(cx - 220, 240, 440, 20, t(words.lead), { font: FONTS.playfair, size: 13.5, italic: true, color: mist, align: "center", shrink: true }),
      text(cx - 220, 264, 440, 60, t("studio.tpl.recipientName"), { font: FONTS.josefin, size: 40, color: cream, spacing: 3, upper: true, align: "center", valign: "middle", lineHeight: 1.2, shrink: true }),
      box("rect", cx - 90, 334, 180, 1.4, foil("gold", 0)),
      text(cx - 200, 348, 400, 58, t(words.body), { font: FONTS.playfair, size: 12.5, color: mist, lineHeight: 1.5, align: "center", shrink: true }),
      ...signature(cx - 214, 486, t(words.left), "{date}", cream, FONTS.josefin, gold, 180),
      ...signature(cx + 34, 486, t(words.right), "", cream, FONTS.josefin, gold, 180),
    ]),
  ]);
}

function courseQr(context: TemplateContext, words: Wording) {
  const { t } = context;
  const indigo = "#3730a3";
  const violet = "#5b21b6";
  const teal = "#0d9488";
  const ink = "#111827";
  const slate = "#4b5563";
  const hairline = "#e5e7eb";
  const [heading, subtitle] = titleLines(context, words);
  const card = { x: 548, y: 124, width: 222, height: 340 };
  const stat = (x: number, label: string, value: string) => [
    text(x, 404, 124, 14, label, { font: FONTS.inter, size: 9, bold: true, color: slate, spacing: 1.5, upper: true, shrink: true }),
    text(x, 420, 124, 24, value, { font: FONTS.poppins, size: 15, bold: true, color: ink, shrink: true, valign: "middle" }),
  ];
  return design(t(words.title), [indigo, violet, teal, ink], [
    pageOf(SIZE, gradient(135, ["#eef2ff", "#f0fdfa"]), [
      art("topographic", { primary: "#c7d2fe", secondary: "#99f6e4" }, 0, 0, W, H, { opacity: 0.6 }),
      shadowed(box("rect", 36, 36, W - 72, H - 72, solid("#ffffff"), { radius: 24 }), "lifted"),
      box("rect", 76, 36, W - 152, 5, gradient(0, [indigo, violet, teal]), { radius: 2.5 }),
      text(80, 72, 360, 18, t("studio.tpl.orgName"), { font: FONTS.poppins, size: 11, bold: true, color: ink, spacing: 2, upper: true, shrink: true }),
      box("rect", W - 230, 68, 150, 26, solid("#eef2ff"), { radius: 13 }),
      text(W - 222, 68, 134, 26, t("studio.tpl.courseQrBadge"), { font: FONTS.inter, size: 9.5, bold: true, color: indigo, spacing: 1.5, upper: true, align: "center", valign: "middle", shrink: true }),
      text(80, 116, 440, 48, heading, { font: FONTS.poppins, size: 34, bold: true, color: ink, lineHeight: 1.2, shrink: true, valign: "middle" }),
      text(80, 164, 440, 32, subtitle, { font: FONTS.poppins, size: 22, color: violet, lineHeight: 1.2, shrink: true, valign: "middle" }),
      text(80, 214, 440, 18, t(words.lead), { font: FONTS.inter, size: 11.5, color: slate, shrink: true }),
      text(80, 236, 440, 60, t("studio.tpl.recipientName"), { font: FONTS.poppins, size: 40, bold: true, color: ink, lineHeight: 1.2, shrink: true, valign: "middle" }),
      box("rect", 80, 302, 96, 4, gradient(0, [indigo, teal]), { radius: 2 }),
      text(80, 322, 440, 20, t(words.body), { font: FONTS.inter, size: 12, color: slate, shrink: true }),
      text(80, 344, 440, 30, t("studio.tpl.courseQrCourse"), { font: FONTS.poppins, size: 20, bold: true, color: indigo, lineHeight: 1.2, shrink: true, valign: "middle" }),
      rule(80, 392, 440, hairline, 1),
      ...stat(80, t("studio.tpl.date"), "{date}"),
      vrule(220, 404, 40, hairline, 1),
      ...stat(236, t("studio.tpl.duration"), t("studio.tpl.courseQrHours")),
      vrule(376, 404, 40, hairline, 1),
      ...stat(392, t("studio.tpl.score"), "96 / 100"),
      ...signature(80, 512, t(words.left), "", ink, FONTS.inter, "#9ca3af", 180),
      ...signature(310, 512, t(words.right), "", ink, FONTS.inter, "#9ca3af", 180),
      shadowed(box("rect", card.x, card.y, card.width, card.height, solid("#f8f7ff"), { radius: 18, stroke: stroke("#e0e7ff", 1) }), "soft"),
      shadowed(box("rect", card.x + 31, card.y + 24, 160, 160, solid("#ffffff"), { radius: 14 }), "soft"),
      qr("https://example.com/verify", card.x + 41, card.y + 34, 140, ink),
      text(card.x + 16, card.y + 198, card.width - 32, 24, t("studio.tpl.courseQrVerify"), { font: FONTS.poppins, size: 13, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
      rule(card.x + 70, card.y + 236, card.width - 140, "#c7d2fe", 1),
      text(card.x + 16, card.y + 250, card.width - 32, 14, t("studio.tpl.courseQrId"), { font: FONTS.inter, size: 9, bold: true, color: slate, spacing: 1.5, upper: true, align: "center", shrink: true }),
      text(card.x + 16, card.y + 268, card.width - 32, 26, "VP-{n}", { font: FONTS.poppins, size: 18, bold: true, color: indigo, spacing: 2, align: "center", valign: "middle" }),
      shadowed(art("starSeal", { primary: teal, secondary: "#ffffff" }, card.x + card.width - 52, card.y - 34, 80, 80), "soft"),
      art("laurel", { primary: "#a5b4fc", secondary: "#5eead4" }, card.x + card.width / 2 - 20, card.y + 298, 40, 38, { opacity: 0.9 }),
    ]),
  ]);
}

const words = (title: string, subtitle: string, lead: string, body: string, left = "studio.tpl.date", right = "studio.tpl.director"): Wording => ({ title, subtitle, lead, body, left, right });

export const CERTIFICATE_TEMPLATES: StudioTemplate[] = [
  { id: "achievement", category: "certificates", size: SIZE, build: (context) => classic(context, words("studio.templates.items.achievement", "studio.tpl.ofAchievement", "studio.tpl.presentedTo", "studio.tpl.achievementBody"), PALETTES.midnightGold, "guillocheBorder", PALETTES.midnightGold.accent2) },
  { id: "participation", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.participation", "studio.tpl.ofParticipation", "studio.tpl.presentedTo", "studio.tpl.participationBody", "studio.tpl.date", "studio.tpl.coordinator"), PALETTES.oceanMist, "laurel", "topographic") },
  { id: "appreciation", category: "certificates", size: SIZE, build: (context) => ornate(context, words("studio.templates.items.appreciation", "studio.tpl.ofAppreciation", "studio.tpl.presentedTo", "studio.tpl.appreciationBody"), PALETTES.burgundyGold, "nouveauFrame") },
  { id: "completion", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.completion", "studio.tpl.ofCompletion", "studio.tpl.awardedTo", "studio.tpl.completionBody", "studio.tpl.date", "studio.tpl.instructor"), PALETTES.cobaltSun, "arcRings", "halftone") },
  { id: "diploma", category: "certificates", size: SIZE, build: (context) => deco(context, words("studio.templates.items.diploma", "studio.tpl.diploma", "studio.tpl.awardedTo", "studio.tpl.diplomaBody", "studio.tpl.date", "studio.tpl.principal")) },
  { id: "employeeOfMonth", category: "certificates", size: SIZE, build: (context) => spotlight(context, words("studio.templates.items.employeeOfMonth", "studio.tpl.employeeOfMonth", "studio.tpl.awardedTo", "studio.tpl.employeeBody", "studio.tpl.date", "studio.tpl.manager"), PALETTES.ivoryNavy) },
  { id: "training", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.training", "studio.tpl.ofTraining", "studio.tpl.presentedTo", "studio.tpl.trainingBody", "studio.tpl.date", "studio.tpl.instructor"), PALETTES.forestCream, "laurel", "honeycomb") },
  { id: "kids", category: "certificates", size: SIZE, build: (context) => playful(context, words("studio.templates.items.kids", "studio.tpl.kidsTitle", "studio.tpl.kidsLead", "studio.tpl.kidsBody", "studio.tpl.date", "studio.tpl.teacher")) },
  { id: "sports", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.sports", "studio.tpl.champion", "studio.tpl.awardedTo", "studio.tpl.sportsBody", "studio.tpl.date", "studio.tpl.coach"), PALETTES.burgundyGold, "shield", "diagonalHatch") },
  { id: "volunteer", category: "certificates", size: SIZE, build: (context) => ornate(context, words("studio.templates.items.volunteer", "studio.tpl.ofVolunteering", "studio.tpl.presentedTo", "studio.tpl.volunteerBody", "studio.tpl.date", "studio.tpl.coordinator"), PALETTES.sageLinen, "gemFrame") },
  { id: "giftVoucher", category: "certificates", size: SIZE, build: voucher },
  { id: "excellence", category: "certificates", size: SIZE, build: (context) => classic(context, words("studio.templates.items.excellence", "studio.tpl.ofExcellence", "studio.tpl.presentedTo", "studio.tpl.excellenceBody"), PALETTES.plumChampagne, "nouveauFrame", PALETTES.plumChampagne.accent) },
  { id: "foilExcellence", category: "certificates", size: SIZE, build: (context) => foilExcellence(context, words("studio.templates.items.foilExcellence", "studio.tpl.foilExcellenceTitle", "studio.tpl.presentedTo", "studio.tpl.foilExcellenceBody")) },
  { id: "modernAward", category: "certificates", size: SIZE, build: (context) => modernAward(context, words("studio.templates.items.modernAward", "studio.tpl.modernAwardCategory", "studio.tpl.awardedTo", "studio.tpl.modernAwardBody")) },
  { id: "botanicalAppreciation", category: "certificates", size: SIZE, build: (context) => botanicalAppreciation(context, words("studio.templates.items.botanicalAppreciation", "studio.tpl.ofAppreciation", "studio.tpl.presentedTo", "studio.tpl.botanicalAppreciationBody", "studio.tpl.date", "studio.tpl.coordinator")) },
  { id: "decoHonour", category: "certificates", size: SIZE, build: (context) => decoHonour(context, words("studio.templates.items.decoHonour", "studio.tpl.decoHonourTitle", "studio.tpl.awardedTo", "studio.tpl.decoHonourBody")) },
  { id: "courseQr", category: "certificates", size: SIZE, build: (context) => courseQr(context, words("studio.templates.items.courseQr", "studio.tpl.ofCompletion", "studio.tpl.presentedTo", "studio.tpl.courseQrLead", "studio.tpl.instructor", "studio.tpl.director")) },
];
