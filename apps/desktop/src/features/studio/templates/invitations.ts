import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, frame, linear, pageOf, qr, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext } from "./kit";

const SIZE = "a5" as const;
const { width: W, height: H } = sizeOf(SIZE);
const page = { width: W, height: H };

function balloon(x: number, y: number, size: number, color: string): StudioElement[] {
  return [
    box("rect", x + size / 2 - 0.5, y + size * 1.2, 1, size * 0.7, solid("#b6bcc6")),
    box("ellipse", x, y, size, size * 1.22, linear(135, color, color), { opacity: 0.95 }),
    box("ellipse", x + size * 0.2, y + size * 0.2, size * 0.22, size * 0.32, solid("#ffffff"), { opacity: 0.45 }),
  ];
}

function wedding({ t }: TemplateContext) {
  const sage = "#5f7161";
  const gold = "#b08d57";
  const colours = { primary: sage, secondary: gold };
  return design(t("studio.templates.items.wedding"), [sage, gold], [
    pageOf(SIZE, solid("#fbf8f3"), [
      frame("ornateFrame", colours, page),
      centredText(page, 86, 18, t("studio.tpl.togetherWithFamilies"), { font: FONTS.cormorant, size: 12, color: "#6b7280", spacing: 3, upper: true, shrink: true }),
      centredText(page, 116, 96, t("studio.tpl.coupleNames"), { font: FONTS.greatVibes, size: 50, color: sage, lineHeight: 1.05, shrink: true, valign: "middle" }),
      art("flourishDivider", colours, W / 2 - 90, 220, 180, 24),
      centredText(page, 256, 44, t("studio.tpl.weddingLine"), { font: FONTS.cormorant, size: 15, italic: true, color: "#374151", lineHeight: 1.35, shrink: true }),
      centredText(page, 318, 24, t("studio.tpl.weddingDate"), { font: FONTS.cormorant, size: 17, bold: true, color: "#1f2937", spacing: 2, upper: true, shrink: true }),
      centredText(page, 346, 20, t("studio.tpl.weddingTime"), { font: FONTS.cormorant, size: 14, color: "#4b5563", shrink: true }),
      centredText(page, 384, 40, t("studio.tpl.venue"), { font: FONTS.cormorant, size: 14, color: "#374151", lineHeight: 1.35, shrink: true }),
      centredText(page, 444, 20, t("studio.tpl.reception"), { font: FONTS.greatVibes, size: 20, color: gold, shrink: true }),
      centredText(page, 500, 18, t("studio.tpl.rsvp"), { font: FONTS.cormorant, size: 11, color: "#6b7280", spacing: 2, upper: true, shrink: true }),
    ]),
  ]);
}

function birthday({ t }: TemplateContext) {
  const sun = "#f59e0b";
  const coral = "#f43f5e";
  const sky = "#0ea5e9";
  return design(t("studio.templates.items.birthday"), [coral, sun, sky], [
    pageOf(SIZE, linear(180, "#fff7ed", "#ffe4e6"), [
      art("confetti", { primary: coral, secondary: sky }, 10, 10, W - 20, 180, { opacity: 0.7 }),
      ...balloon(40, 60, 70, coral),
      ...balloon(W - 112, 44, 76, sky),
      ...balloon(W / 2 - 30, 18, 60, sun),
      centredText(page, 200, 70, t("studio.tpl.letsCelebrate"), { font: FONTS.pacifico, size: 40, color: coral, shrink: true }),
      centredText(page, 274, 56, t("studio.tpl.birthdayName"), { font: FONTS.nunito, size: 26, bold: true, color: "#1f2937", lineHeight: 1.15, shrink: true }),
      box("rect", 60, 352, W - 120, 120, solid("#ffffff"), { radius: 20, opacity: 0.9 }),
      centredText(page, 368, 24, t("studio.tpl.birthdayDate"), { font: FONTS.nunito, size: 16, bold: true, color: coral, shrink: true, inset: 80 }),
      centredText(page, 396, 22, t("studio.tpl.birthdayTime"), { font: FONTS.nunito, size: 14, color: "#374151", shrink: true, inset: 80 }),
      centredText(page, 422, 38, t("studio.tpl.birthdayPlace"), { font: FONTS.nunito, size: 13, color: "#4b5563", lineHeight: 1.3, shrink: true, inset: 80 }),
      centredText(page, 500, 30, t("studio.tpl.birthdayRsvp"), { font: FONTS.caveat, size: 22, color: "#6b21a8", shrink: true }),
    ]),
  ]);
}

function party({ t }: TemplateContext) {
  const neon = "#f472b6";
  const violet = "#8b5cf6";
  return design(t("studio.templates.items.party"), [neon, violet], [
    pageOf(SIZE, solid("#0b0f1a"), [
      art("blob", { primary: violet, secondary: neon }, -80, -60, 320, 320, { opacity: 0.85 }),
      art("blob", { primary: neon, secondary: "#22d3ee" }, W - 190, H - 250, 300, 300, { opacity: 0.75, rotation: 200 }),
      art("arcRings", { primary: "#22d3ee", secondary: neon }, W - 170, 40, 140, 140),
      text(40, 190, W - 80, 170, t("studio.tpl.partyNight"), { font: FONTS.bebas, size: 92, color: "#ffffff", lineHeight: 0.92, shrink: true, valign: "middle" }),
      text(40, 360, W - 80, 26, t("studio.tpl.partyLine"), { font: FONTS.montserrat, size: 15, bold: true, color: neon, spacing: 3, upper: true, shrink: true }),
      rule(40, 398, 80, "#22d3ee", 3),
      text(40, 414, W - 80, 22, t("studio.tpl.partyDate"), { font: FONTS.montserrat, size: 14, color: "#e5e7eb", shrink: true }),
      text(40, 440, W - 80, 22, t("studio.tpl.partyPlace"), { font: FONTS.montserrat, size: 14, color: "#e5e7eb", shrink: true }),
      text(40, 520, W - 80, 22, t("studio.tpl.dressCode"), { font: FONTS.montserrat, size: 11, color: "#9ca3af", spacing: 2, upper: true, shrink: true }),
    ]),
  ]);
}

function babyShower({ t }: TemplateContext) {
  const blue = "#93c5fd";
  const pink = "#f9a8d4";
  return design(t("studio.templates.items.babyShower"), [blue, pink], [
    pageOf(SIZE, solid("#f8fbff"), [
      art("blob", { primary: pink, secondary: blue }, -70, H - 180, 230, 230, { opacity: 0.5 }),
      art("blob", { primary: blue, secondary: pink }, W - 150, -60, 220, 220, { opacity: 0.5, rotation: 90 }),
      art("scallopSeal", { primary: "#ffffff", secondary: blue }, W / 2 - 95, 70, 190, 190),
      centredText(page, 125, 80, t("studio.tpl.ohBaby"), { font: FONTS.dancing, size: 38, bold: true, color: "#60a5fa", shrink: true, inset: 135, valign: "middle" }),
      centredText(page, 290, 22, t("studio.tpl.babyShowerFor"), { font: FONTS.nunito, size: 14, color: "#6b7280", spacing: 1, shrink: true }),
      centredText(page, 316, 40, t("studio.tpl.parentName"), { font: FONTS.nunito, size: 26, bold: true, color: "#1f2937", shrink: true }),
      art("dotsDivider", { primary: pink, secondary: blue }, W / 2 - 80, 368, 160, 12),
      centredText(page, 396, 24, t("studio.tpl.showerDate"), { font: FONTS.nunito, size: 15, bold: true, color: "#ec4899", shrink: true }),
      centredText(page, 424, 40, t("studio.tpl.showerPlace"), { font: FONTS.nunito, size: 13, color: "#4b5563", lineHeight: 1.35, shrink: true }),
      centredText(page, 500, 20, t("studio.tpl.rsvp"), { font: FONTS.nunito, size: 11, color: "#6b7280", spacing: 2, upper: true, shrink: true }),
    ]),
  ]);
}

function graduation({ t }: TemplateContext) {
  const navy = "#1e3a5f";
  const gold = "#c9a227";
  const colours = { primary: gold, secondary: navy };
  return design(t("studio.templates.items.graduation"), [navy, gold], [
    pageOf(SIZE, solid(navy), [
      frame("doubleFrame", { primary: gold, secondary: gold }, page),
      centredText(page, 52, 24, t("studio.tpl.classOf"), { font: FONTS.cinzel, size: 16, color: gold, spacing: 5, upper: true, shrink: true }),
      art("laurel", colours, W / 2 - 80, 80, 160, 153),
      centredText(page, 128, 60, "2027", { font: FONTS.cinzel, size: 40, bold: true, color: "#ffffff", spacing: 2, valign: "middle" }),
      centredText(page, 268, 64, t("studio.tpl.graduationTitle"), { font: FONTS.playfair, size: 34, bold: true, color: "#ffffff", lineHeight: 1.1, shrink: true }),
      centredText(page, 340, 44, t("studio.tpl.graduationLine"), { font: FONTS.lora, size: 14, italic: true, color: "#d1d5db", lineHeight: 1.35, shrink: true }),
      art("diamondDivider", { primary: gold, secondary: gold }, W / 2 - 100, 398, 200, 14),
      centredText(page, 424, 22, t("studio.tpl.graduationDate"), { font: FONTS.lora, size: 15, bold: true, color: "#ffffff", shrink: true }),
      centredText(page, 450, 40, t("studio.tpl.graduationPlace"), { font: FONTS.lora, size: 13, color: "#d1d5db", lineHeight: 1.35, shrink: true }),
    ]),
  ]);
}

function corporate({ t }: TemplateContext) {
  const ink = "#0f172a";
  const teal = "#0d9488";
  return design(t("studio.templates.items.corporateEvent"), [teal, ink], [
    pageOf(SIZE, solid("#ffffff"), [
      box("rect", 0, 0, W, 210, linear(135, ink, "#134e4a")),
      art("arcRings", { primary: teal, secondary: "#5eead4" }, W - 180, -40, 220, 220, { opacity: 0.8 }),
      text(36, 50, W - 72, 18, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 11, bold: true, color: "#5eead4", spacing: 3, upper: true, shrink: true }),
      text(36, 80, W - 120, 22, t("studio.tpl.youAreInvited"), { font: FONTS.montserrat, size: 14, color: "#e2e8f0", shrink: true }),
      text(36, 108, W - 110, 80, t("studio.tpl.corporateTitle"), { font: FONTS.montserrat, size: 30, bold: true, color: "#ffffff", lineHeight: 1.1, shrink: true }),
      text(36, 240, W - 72, 60, t("studio.tpl.corporateBody"), { font: FONTS.inter, size: 13, color: "#374151", lineHeight: 1.5, shrink: true }),
      box("rect", 36, 320, 4, 96, solid(teal)),
      text(52, 320, W - 200, 22, t("studio.tpl.corporateDate"), { font: FONTS.inter, size: 14, bold: true, color: ink, shrink: true }),
      text(52, 346, W - 200, 22, t("studio.tpl.corporateTime"), { font: FONTS.inter, size: 13, color: "#4b5563", shrink: true }),
      text(52, 372, W - 200, 44, t("studio.tpl.corporatePlace"), { font: FONTS.inter, size: 13, color: "#4b5563", lineHeight: 1.35, shrink: true }),
      qr("https://example.com/rsvp", W - 132, 452, 96, ink),
      text(36, 466, W - 190, 22, t("studio.tpl.scanToRsvp"), { font: FONTS.inter, size: 13, bold: true, color: teal, shrink: true }),
      text(36, 490, W - 190, 40, t("studio.tpl.rsvpBy"), { font: FONTS.inter, size: 12, color: "#6b7280", lineHeight: 1.35, shrink: true }),
    ]),
  ]);
}

function dinner({ t }: TemplateContext) {
  const forest = "#0f2e24";
  const gold = "#d4b06a";
  const colours = { primary: gold, secondary: gold };
  return design(t("studio.templates.items.dinner"), [forest, gold], [
    pageOf(SIZE, solid(forest), [
      frame("decoFrame", colours, page),
      centredText(page, 96, 20, t("studio.tpl.youAreInvited"), { font: FONTS.raleway, size: 12, color: gold, spacing: 4, upper: true, shrink: true }),
      centredText(page, 128, 110, t("studio.tpl.dinnerTitle"), { font: FONTS.playfair, size: 44, italic: true, color: "#ffffff", lineHeight: 1.05, shrink: true, valign: "middle" }),
      art("diamondDivider", colours, W / 2 - 100, 252, 200, 14),
      centredText(page, 282, 60, t("studio.tpl.dinnerLine"), { font: FONTS.raleway, size: 13, color: "#d1d5db", lineHeight: 1.45, shrink: true }),
      centredText(page, 360, 22, t("studio.tpl.dinnerDate"), { font: FONTS.raleway, size: 14, bold: true, color: gold, spacing: 2, upper: true, shrink: true }),
      centredText(page, 388, 40, t("studio.tpl.dinnerPlace"), { font: FONTS.raleway, size: 13, color: "#e5e7eb", lineHeight: 1.35, shrink: true }),
      centredText(page, 470, 20, t("studio.tpl.dressCode"), { font: FONTS.raleway, size: 11, color: "#9ca3af", spacing: 2, upper: true, shrink: true }),
    ]),
  ]);
}

function opening({ t }: TemplateContext) {
  const red = "#b91c1c";
  const gold = "#d4a017";
  return design(t("studio.templates.items.opening"), [red, gold], [
    pageOf(SIZE, solid("#fffbf5"), [
      art("waves", { primary: red, secondary: gold }, 0, H - 120, W, 120),
      art("starSeal", { primary: gold, secondary: "#ffffff" }, W / 2 - 60, 50, 120, 120),
      centredText(page, 82, 56, t("studio.tpl.openingBadge"), { font: FONTS.oswald, size: 15, bold: true, color: "#ffffff", upper: true, spacing: 1, inset: W / 2 - 46, shrink: true, valign: "middle" }),
      art("ribbonBanner", { primary: red, secondary: gold }, 30, 190, W - 60, 80),
      text(70, 202, W - 140, 46, t("studio.tpl.grandOpening"), { font: FONTS.raleway, size: 26, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      centredText(page, 292, 44, t("studio.tpl.openingLine"), { font: FONTS.raleway, size: 14, color: "#374151", lineHeight: 1.4, shrink: true }),
      centredText(page, 352, 28, t("studio.tpl.openingDate"), { font: FONTS.raleway, size: 18, bold: true, color: red, shrink: true }),
      centredText(page, 384, 40, t("studio.tpl.openingPlace"), { font: FONTS.raleway, size: 13, color: "#4b5563", lineHeight: 1.35, shrink: true }),
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
