import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, centredText, design, foil, FONTS, frame, gradient, pageOf, radial, rule, shadowed, sizeOf, solid, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
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
];
