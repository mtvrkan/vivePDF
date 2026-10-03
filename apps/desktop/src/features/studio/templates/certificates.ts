import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, linear, pageOf, rule, sizeOf, solid, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";

const SIZE = "a4Landscape" as const;
const { width: W, height: H } = sizeOf(SIZE);

type Wording = { title: string; subtitle: string; lead: string; body: string; left: string; right: string };

function signature(x: number, y: number, label: string, value: string, color: string, font: string, lineColor: string): StudioElement[] {
  return [
    text(x, y - 26, 200, 22, value, { font, size: 13, color, align: "center", valign: "bottom", shrink: true }),
    rule(x, y, 200, lineColor, 0.8),
    text(x, y + 6, 200, 18, label, { font, size: 11, color, align: "center", spacing: 1, upper: true }),
  ];
}

function classic(context: TemplateContext, words: Wording, primary: string, secondary: string) {
  const { t } = context;
  const colours = { primary, secondary };
  return design(t(words.title), [primary, secondary], [
    pageOf(SIZE, solid("#fffdf7"), [
      frame("guillocheFrame", colours, { width: W, height: H }),
      centredText({ width: W }, 74, 18, t("studio.tpl.orgName"), { font: FONTS.cinzel, size: 11, color: primary, spacing: 4, shrink: true }),
      centredText({ width: W }, 96, 64, t("studio.tpl.certificate"), { font: FONTS.cinzel, size: 54, bold: true, color: primary, spacing: 6, upper: true, shrink: true }),
      centredText({ width: W }, 158, 48, t(words.subtitle), { font: FONTS.greatVibes, size: 36, color: secondary, shrink: true }),
      centredText({ width: W }, 222, 24, t(words.lead), { font: FONTS.garamond, size: 15, italic: true, color: "#4b5563", shrink: true }),
      centredText({ width: W }, 250, 72, t("studio.tpl.recipientName"), { font: FONTS.greatVibes, size: 54, color: "#1f2937", shrink: true, valign: "middle" }),
      rule(W * 0.28, 324, W * 0.44, secondary, 1),
      centredText({ width: W }, 336, 52, t(words.body), { font: FONTS.garamond, size: 14, color: "#374151", lineHeight: 1.4, inset: W * 0.2, shrink: true }),
      art("ribbonSeal", colours, W / 2 - 46, 398, 92, 115),
      ...signature(110, 482, t(words.left), "{date}", "#374151", FONTS.garamond, primary),
      ...signature(W - 310, 482, t(words.right), "", "#374151", FONTS.garamond, primary),
    ]),
  ]);
}

function band(context: TemplateContext, words: Wording, primary: string, secondary: string, emblem: "laurel" | "shield" | "arcRings") {
  const { t } = context;
  const left = 250;
  const content = W - left - 70;
  const white = { primary: "#ffffff", secondary };
  return design(t(words.title), [primary, secondary], [
    pageOf(SIZE, solid("#ffffff"), [
      box("rect", 0, 0, 200, H, linear(180, primary, "#0b1220")),
      box("rect", 200, 0, 8, H, solid(secondary)),
      emblem === "shield" ? art("shield", white, 52, 150, 96, 120) : emblem === "laurel" ? art("laurel", white, 30, 160, 140, 134) : art("arcRings", white, 30, 150, 140, 140),
      text(20, 330, 160, 40, "2026", { font: FONTS.montserrat, size: 30, bold: true, color: "#ffffff", align: "center", spacing: 2 }),
      art("cornerTriangles", { primary, secondary }, W - 140, 0, 140, 140, { rotation: 90 }),
      text(left, 92, content, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 11, bold: true, color: primary, spacing: 3, upper: true }),
      text(left, 118, content, 56, t("studio.tpl.certificate"), { font: FONTS.montserrat, size: 46, bold: true, color: "#111827", spacing: 3, upper: true, shrink: true }),
      text(left, 174, content, 28, t(words.subtitle), { font: FONTS.montserrat, size: 18, color: primary, spacing: 6, upper: true, shrink: true }),
      text(left, 236, content, 22, t(words.lead), { font: FONTS.inter, size: 13, color: "#6b7280", shrink: true }),
      text(left, 262, content, 60, t("studio.tpl.recipientName"), { font: FONTS.playfair, size: 44, bold: true, color: "#111827", shrink: true, valign: "middle" }),
      rule(left, 330, content * 0.7, secondary, 2),
      text(left, 346, content * 0.85, 60, t(words.body), { font: FONTS.inter, size: 13, color: "#374151", lineHeight: 1.5, shrink: true }),
      ...signature(left, 486, t(words.left), "{date}", "#374151", FONTS.inter, "#9ca3af"),
      ...signature(left + 280, 486, t(words.right), "", "#374151", FONTS.inter, "#9ca3af"),
    ]),
  ]);
}

function ornate(context: TemplateContext, words: Wording, primary: string, secondary: string, background: string) {
  const { t } = context;
  const colours = { primary, secondary };
  return design(t(words.title), [primary, secondary], [
    pageOf(SIZE, solid(background), [
      frame("ornateFrame", colours, { width: W, height: H }),
      centredText({ width: W }, 92, 74, t(words.subtitle), { font: FONTS.parisienne, size: 58, color: primary, shrink: true }),
      centredText({ width: W }, 168, 22, t("studio.tpl.certificate"), { font: FONTS.cormorant, size: 16, bold: true, color: secondary, spacing: 8, upper: true, shrink: true }),
      art("flourishDivider", colours, W / 2 - 120, 196, 240, 32),
      centredText({ width: W }, 240, 24, t(words.lead), { font: FONTS.cormorant, size: 17, italic: true, color: "#4b5563", shrink: true }),
      centredText({ width: W }, 266, 70, t("studio.tpl.recipientName"), { font: FONTS.cormorant, size: 50, bold: true, color: "#1f2937", shrink: true, valign: "middle" }),
      centredText({ width: W }, 344, 54, t(words.body), { font: FONTS.cormorant, size: 16, color: "#374151", lineHeight: 1.35, inset: W * 0.2, shrink: true }),
      art("laurel", colours, W / 2 - 42, 410, 84, 80),
      ...signature(120, 486, t(words.left), "{date}", "#374151", FONTS.cormorant, secondary),
      ...signature(W - 320, 486, t(words.right), "", "#374151", FONTS.cormorant, secondary),
    ]),
  ]);
}

function deco(context: TemplateContext, words: Wording, background: string, gold: string) {
  const { t } = context;
  const colours = { primary: gold, secondary: gold };
  return design(t(words.title), [gold, background], [
    pageOf(SIZE, solid(background), [
      frame("decoFrame", colours, { width: W, height: H }),
      art("scallopSeal", { primary: gold, secondary: background }, W / 2 - 40, 62, 80, 80),
      text(W / 2 - 40, 86, 80, 32, "★", { font: FONTS.inter, size: 26, color: background, align: "center", valign: "middle" }),
      centredText({ width: W }, 160, 60, t(words.subtitle), { font: FONTS.cinzel, size: 44, bold: true, color: gold, spacing: 5, upper: true, shrink: true }),
      art("diamondDivider", colours, W / 2 - 150, 228, 300, 20),
      centredText({ width: W }, 262, 22, t(words.lead), { font: FONTS.raleway, size: 14, color: "#e5e7eb", spacing: 1, shrink: true }),
      centredText({ width: W }, 290, 64, t("studio.tpl.recipientName"), { font: FONTS.playfair, size: 44, italic: true, color: "#ffffff", shrink: true, valign: "middle" }),
      centredText({ width: W }, 364, 50, t(words.body), { font: FONTS.raleway, size: 13, color: "#d1d5db", lineHeight: 1.5, inset: W * 0.2, shrink: true }),
      ...signature(130, 486, t(words.left), "{date}", "#e5e7eb", FONTS.raleway, gold),
      ...signature(W - 330, 486, t(words.right), "", "#e5e7eb", FONTS.raleway, gold),
    ]),
  ]);
}

function minimal(context: TemplateContext, words: Wording, primary: string, secondary: string) {
  const { t } = context;
  const colours = { primary, secondary };
  return design(t(words.title), [primary, secondary], [
    pageOf(SIZE, solid("#ffffff"), [
      frame("doubleFrame", colours, { width: W, height: H }),
      art("starSeal", colours, W - 190, 70, 110, 110),
      text(W - 190, 100, 110, 50, t("studio.tpl.monthBadge"), { font: FONTS.oswald, size: 14, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, shrink: true }),
      text(90, 92, 520, 70, t(words.subtitle), { font: FONTS.oswald, size: 50, bold: true, color: primary, upper: true, spacing: 2, shrink: true }),
      text(90, 166, 520, 22, t(words.lead), { font: FONTS.lora, size: 15, italic: true, color: "#6b7280", shrink: true }),
      text(90, 214, 600, 80, t("studio.tpl.recipientName"), { font: FONTS.lora, size: 56, bold: true, color: "#111827", shrink: true, valign: "middle" }),
      box("rect", 90, 304, 90, 6, solid(secondary)),
      text(90, 330, 560, 70, t(words.body), { font: FONTS.lora, size: 15, color: "#374151", lineHeight: 1.5, shrink: true }),
      ...signature(90, 482, t(words.left), "{date}", "#374151", FONTS.lora, "#9ca3af"),
      ...signature(370, 482, t(words.right), "", "#374151", FONTS.lora, "#9ca3af"),
    ]),
  ]);
}

function playful(context: TemplateContext, words: Wording) {
  const { t } = context;
  const pink = "#ec4899";
  const violet = "#7c3aed";
  const sun = "#f59e0b";
  return design(t(words.title), [violet, pink, sun], [
    pageOf(SIZE, linear(160, "#fdf2f8", "#ede9fe"), [
      art("blob", { primary: pink, secondary: violet }, -60, -70, 260, 260, { opacity: 0.85 }),
      art("blob", { primary: sun, secondary: pink }, W - 210, H - 220, 280, 280, { opacity: 0.8, rotation: 140 }),
      art("confetti", { primary: violet, secondary: sun }, 120, 40, 600, 400, { opacity: 0.55 }),
      box("rect", 150, 90, W - 300, H - 180, solid("#ffffff"), { radius: 36, stroke: { color: violet, width: 3, dash: "dashed" } }),
      centredText({ width: W }, 118, 70, t(words.subtitle), { font: FONTS.pacifico, size: 48, color: violet, shrink: true, inset: 190 }),
      centredText({ width: W }, 194, 24, t(words.lead), { font: FONTS.nunito, size: 16, bold: true, color: "#6b7280", shrink: true, inset: 190 }),
      centredText({ width: W }, 224, 70, t("studio.tpl.kidName"), { font: FONTS.caveat, size: 58, bold: true, color: pink, shrink: true, inset: 190, valign: "middle" }),
      centredText({ width: W }, 300, 60, t(words.body), { font: FONTS.nunito, size: 16, color: "#374151", lineHeight: 1.4, inset: 210, shrink: true }),
      art("starSeal", { primary: sun, secondary: "#ffffff" }, W / 2 - 38, 368, 76, 76),
      ...signature(200, 470, t(words.left), "{date}", "#4b5563", FONTS.nunito, violet),
      ...signature(W - 400, 470, t(words.right), "", "#4b5563", FONTS.nunito, violet),
    ]),
  ]);
}

function voucher(context: TemplateContext) {
  const { t } = context;
  const ink = "#0f172a";
  const rose = "#be185d";
  const blush = "#fce7f3";
  const stubX = W - 250;
  return design(t("studio.templates.items.giftVoucher"), [rose, ink], [
    pageOf(SIZE, solid("#ffffff"), [
      box("rect", 40, 120, W - 80, 360, solid(blush), { radius: 18 }),
      box("rect", stubX, 120, W - 40 - stubX, 360, solid(rose), { radius: 18 }),
      box("rect", stubX, 120, 30, 360, solid(rose)),
      vrule(stubX, 140, 320, "#ffffff", 2, "dashed"),
      art("ribbonBanner", { primary: rose, secondary: ink }, 80, 150, 300, 70),
      text(110, 162, 240, 40, t("studio.tpl.giftVoucher"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(80, 240, stubX - 120, 22, t("studio.tpl.voucherLead"), { font: FONTS.lora, size: 15, italic: true, color: "#4b5563", shrink: true }),
      text(80, 268, stubX - 120, 70, t("studio.tpl.voucherService"), { font: FONTS.playfair, size: 34, bold: true, color: ink, lineHeight: 1.15, shrink: true }),
      text(80, 360, 260, 20, t("studio.tpl.voucherFrom"), { font: FONTS.inter, size: 12, color: "#6b7280" }),
      rule(80, 400, 240, "#9ca3af", 0.8),
      text(80, 420, stubX - 120, 20, t("studio.tpl.validUntil"), { font: FONTS.inter, size: 11, color: "#6b7280", shrink: true }),
      text(stubX + 20, 180, W - 60 - stubX - 20, 30, t("studio.tpl.voucherValueLabel"), { font: FONTS.inter, size: 13, bold: true, color: "#fbcfe8", align: "center", spacing: 3, upper: true, shrink: true }),
      text(stubX + 20, 214, W - 60 - stubX - 20, 80, t("studio.tpl.voucherAmount"), { font: FONTS.abril, size: 54, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      text(stubX + 20, 330, W - 60 - stubX - 20, 20, t("studio.tpl.code"), { font: FONTS.inter, size: 11, color: "#fbcfe8", align: "center", spacing: 3, upper: true }),
      text(stubX + 20, 352, W - 60 - stubX - 20, 28, "VP-{n}", { font: FONTS.oswald, size: 22, bold: true, color: "#ffffff", align: "center", spacing: 2 }),
    ]),
  ]);
}

const words = (title: string, subtitle: string, lead: string, body: string, left = "studio.tpl.date", right = "studio.tpl.director"): Wording => ({ title, subtitle, lead, body, left, right });

export const CERTIFICATE_TEMPLATES: StudioTemplate[] = [
  { id: "achievement", category: "certificates", size: SIZE, build: (context) => classic(context, words("studio.templates.items.achievement", "studio.tpl.ofAchievement", "studio.tpl.presentedTo", "studio.tpl.achievementBody"), "#1f3a68", "#b8892a") },
  { id: "participation", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.participation", "studio.tpl.ofParticipation", "studio.tpl.presentedTo", "studio.tpl.participationBody", "studio.tpl.date", "studio.tpl.coordinator"), "#0f766e", "#f59e0b", "laurel") },
  { id: "appreciation", category: "certificates", size: SIZE, build: (context) => ornate(context, words("studio.templates.items.appreciation", "studio.tpl.ofAppreciation", "studio.tpl.presentedTo", "studio.tpl.appreciationBody"), "#7f1d1d", "#b8892a", "#fffaf3") },
  { id: "completion", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.completion", "studio.tpl.ofCompletion", "studio.tpl.awardedTo", "studio.tpl.completionBody", "studio.tpl.date", "studio.tpl.instructor"), "#1d4ed8", "#38bdf8", "arcRings") },
  { id: "diploma", category: "certificates", size: SIZE, build: (context) => deco(context, words("studio.templates.items.diploma", "studio.tpl.diploma", "studio.tpl.awardedTo", "studio.tpl.diplomaBody", "studio.tpl.date", "studio.tpl.principal"), "#121620", "#d4af37") },
  { id: "employeeOfMonth", category: "certificates", size: SIZE, build: (context) => minimal(context, words("studio.templates.items.employeeOfMonth", "studio.tpl.employeeOfMonth", "studio.tpl.awardedTo", "studio.tpl.employeeBody", "studio.tpl.date", "studio.tpl.manager"), "#111827", "#d4a017") },
  { id: "training", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.training", "studio.tpl.ofTraining", "studio.tpl.presentedTo", "studio.tpl.trainingBody", "studio.tpl.date", "studio.tpl.instructor"), "#166534", "#84cc16", "laurel") },
  { id: "kids", category: "certificates", size: SIZE, build: (context) => playful(context, words("studio.templates.items.kids", "studio.tpl.kidsTitle", "studio.tpl.kidsLead", "studio.tpl.kidsBody", "studio.tpl.date", "studio.tpl.teacher")) },
  { id: "sports", category: "certificates", size: SIZE, build: (context) => band(context, words("studio.templates.items.sports", "studio.tpl.champion", "studio.tpl.awardedTo", "studio.tpl.sportsBody", "studio.tpl.date", "studio.tpl.coach"), "#b91c1c", "#1e3a8a", "shield") },
  { id: "volunteer", category: "certificates", size: SIZE, build: (context) => ornate(context, words("studio.templates.items.volunteer", "studio.tpl.ofVolunteering", "studio.tpl.presentedTo", "studio.tpl.volunteerBody", "studio.tpl.date", "studio.tpl.coordinator"), "#14532d", "#a16207", "#fbfdf8") },
  { id: "giftVoucher", category: "certificates", size: SIZE, build: voucher },
  { id: "excellence", category: "certificates", size: SIZE, build: (context) => classic(context, words("studio.templates.items.excellence", "studio.tpl.ofExcellence", "studio.tpl.presentedTo", "studio.tpl.excellenceBody"), "#4c1d95", "#b8892a") },
];
