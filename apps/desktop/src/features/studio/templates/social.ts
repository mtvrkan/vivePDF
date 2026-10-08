import type { StudioElement, StudioFill } from "@/types/studio";
import { art, box, centredText, design, foil, FONTS, gradient, pageOf, photo, radial, rule, shadowed, sizeOf, solid, stroke, text, type ShadowPreset, type StudioTemplate, type TemplateContext, type TextOptions } from "./kit";

const SQUARE = "square" as const;
const STORY = "story" as const;
const PORTRAIT = { width: 810, height: 1012.5 };
const THUMBNAIL = { width: 960, height: 540 };
const BANNER = { width: 1188, height: 297 };
const PIN = { width: 750, height: 1125 };

type SlotOptions = { radius?: number; circle?: boolean; shadow?: ShadowPreset; tint?: string };

function slot(x: number, y: number, width: number, height: number, backing: string, options: SlotOptions = {}): StudioElement[] {
  const radius = options.radius ?? 0;
  const base = options.circle ? box("ellipse", x, y, width, height, solid(backing)) : box("rect", x, y, width, height, solid(backing), { radius });
  const image = options.circle ? photo(x, y, width, height, "circle") : { ...photo(x, y, width, height, radius ? "rounded" : "none"), cornerRadius: radius };
  return [options.shadow ? shadowed(base, options.shadow, options.tint) : base, image];
}

function orb(x: number, y: number, size: number, inner: string, outer: string, opacity: number): StudioElement {
  return box("ellipse", x, y, size, size, radial(inner, outer), { opacity });
}

function pill(x: number, y: number, width: number, height: number, fill: StudioFill, label: string, options: TextOptions, shadow?: { preset: ShadowPreset; tint?: string }): StudioElement[] {
  const shape = box("rect", x, y, width, height, fill, { radius: height / 2 });
  return [
    shadow ? shadowed(shape, shadow.preset, shadow.tint) : shape,
    text(x + height * 0.4, y, width - height * 0.8, height, label, { align: "center", valign: "middle", shrink: true, ...options }),
  ];
}

function progressDots(centre: number, y: number, count: number, active: number, on: string, off: string): StudioElement[] {
  const gap = 24;
  const start = centre - ((count - 1) * gap) / 2 - 5;
  return Array.from({ length: count }, (_, index) => (index === active ? box("rect", start + index * gap - 8, y, 26, 10, solid(on), { radius: 5 }) : box("ellipse", start + index * gap, y, 10, 10, solid(off))));
}

function quotePost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const pink = "#f472b6";
  const violet = "#a78bfa";
  return design(t("studio.templates.items.quotePost"), ["#1e1b4b", "#4c1d95", "#831843", pink, violet], [
    pageOf(SQUARE, gradient(150, ["#1e1b4b", "#4c1d95", "#831843"]), [
      art("halftone", { primary: "#ffffff", secondary: pink }, 0, 0, page.width, page.height, { opacity: 0.07 }),
      orb(-180, -180, 560, pink, "#4c1d95", 0.4),
      orb(470, 470, 520, violet, "#831843", 0.38),
      art("arcRings", { primary: "#f9a8d4", secondary: "#c4b5fd" }, 480, -130, 460, 460, { opacity: 0.3 }),
      shadowed(box("rect", 96, 120, 618, 568, solid("#ffffff"), { radius: 40, opacity: 0.09, stroke: stroke("#ffffff", 1.5) }), "lifted", "#000000"),
      centredText(page, 140, 140, t("studio.tpl.social.quoteMark"), { font: FONTS.playfair, size: 190, bold: true, color: pink, lineHeight: 1 }),
      centredText(page, 270, 260, t("studio.tpl.social.quoteText"), { font: FONTS.playfair, size: 42, italic: true, color: "#ffffff", lineHeight: 1.28, valign: "middle", shrink: true, inset: 140 }),
      box("rect", page.width / 2 - 40, 556, 80, 4, gradient(0, [pink, violet]), { radius: 2 }),
      centredText(page, 580, 28, t("studio.tpl.social.quoteAuthor"), { font: FONTS.montserrat, size: 15, bold: true, color: "#fbcfe8", spacing: 4, upper: true, valign: "middle", shrink: true, inset: 140 }),
      art("dotsDivider", { primary: pink, secondary: violet }, page.width / 2 - 60, 632, 120, 10),
      box("rect", page.width / 2 - 120, 722, 240, 44, solid("#ffffff"), { radius: 22, opacity: 0.12 }),
      text(page.width / 2 - 104, 722, 208, 44, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 1, shrink: true }),
    ]),
  ]);
}

function productSpotlight({ t }: TemplateContext) {
  const deep = "#022c22";
  const forest = "#064e3b";
  const emerald = "#10b981";
  const lemon = "#facc15";
  const features = ["studio.tpl.social.feature1", "studio.tpl.social.feature2", "studio.tpl.social.feature3"];
  return design(t("studio.templates.items.productSpotlight"), [deep, forest, emerald, lemon, "#ffffff"], [
    pageOf(SQUARE, gradient(160, [deep, forest]), [
      art("topographic", { primary: "#34d399", secondary: emerald }, 0, 0, 810, 810, { opacity: 0.14 }),
      orb(330, 20, 560, emerald, forest, 0.5),
      art("arcRings", { primary: "#6ee7b7", secondary: lemon }, 380, 50, 460, 460, { opacity: 0.35 }),
      ...slot(430, 88, 320, 420, "#a7f3d0", { radius: 28, shadow: "lifted", tint: "#000000" }),
      shadowed(box("burst", 636, 372, 148, 148, solid(lemon), { rotation: 12, points: 18, inner: 0.84 }), "lifted", "#000000"),
      text(656, 412, 108, 68, t("studio.tpl.social.productBadge"), { font: FONTS.poppins, size: 24, bold: true, color: deep, align: "center", valign: "middle", lineHeight: 1, rotation: 12, shrink: true }),
      ...pill(64, 88, 200, 40, solid(lemon), t("studio.tpl.social.productTag"), { font: FONTS.inter, size: 13, bold: true, color: deep, spacing: 2, upper: true }),
      text(64, 152, 336, 224, t("studio.tpl.social.productName"), { font: FONTS.poppins, size: 52, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 64, 396, 64, 6, gradient(0, [lemon, emerald]), { radius: 3 }),
      text(64, 424, 326, 96, t("studio.tpl.social.productLead"), { font: FONTS.inter, size: 17, color: "#d1fae5", lineHeight: 1.45, shrink: true }),
      text(64, 540, 330, 80, t("studio.tpl.social.productPrice"), { font: FONTS.poppins, size: 60, bold: true, color: lemon, valign: "middle", shrink: true }),
      ...pill(430, 552, 320, 64, gradient(90, [lemon, "#fde047"]), t("studio.tpl.shopNow"), { font: FONTS.poppins, size: 19, bold: true, color: deep, spacing: 2, upper: true }, { preset: "lifted", tint: "#000000" }),
      box("rect", 40, 680, 730, 88, solid("#ffffff"), { radius: 28, opacity: 0.08, stroke: stroke("#ffffff", 1) }),
      ...features.flatMap((key, index) => {
        const x = 64 + index * 236;
        return [box("ellipse", x, 716, 16, 16, gradient(135, [lemon, emerald])), text(x + 26, 701, 196, 46, t(key), { font: FONTS.inter, size: 15, bold: true, color: "#ffffff", valign: "middle", shrink: true })];
      }),
    ]),
  ]);
}

function newsPost({ t }: TemplateContext) {
  const yellow = "#facc15";
  const blue = "#1d4ed8";
  return design(t("studio.templates.items.newsPost"), [blue, "#7c3aed", "#db2777", yellow, "#ffffff"], [
    pageOf(SQUARE, gradient(135, [blue, "#7c3aed", "#db2777"]), [
      art("diagonalHatch", { primary: "#ffffff", secondary: "#ffffff" }, 0, 0, 810, 810, { opacity: 0.06 }),
      orb(460, -220, 580, "#60a5fa", "#7c3aed", 0.45),
      orb(-240, 500, 540, "#f472b6", "#7c3aed", 0.4),
      art("confetti", { primary: "#ffffff", secondary: yellow }, 0, 0, 810, 810, { opacity: 0.22 }),
      shadowed(box("speech", 64, 72, 280, 108, solid(yellow), { radius: 22 }), "lifted", "#1e1b4b"),
      text(78, 72, 252, 86, t("studio.tpl.social.newsKicker"), { font: FONTS.montserrat, size: 22, bold: true, color: "#1e1b4b", align: "center", valign: "middle", spacing: 2, upper: true, shrink: true }),
      text(64, 212, 682, 316, t("studio.tpl.social.newsTitle"), { font: FONTS.bebas, size: 124, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true, shadow: "deep" }),
      box("rect", 64, 548, 120, 10, gradient(0, [yellow, "#fde68a"]), { radius: 5 }),
      text(64, 580, 620, 96, t("studio.tpl.social.newsBody"), { font: FONTS.montserrat, size: 20, color: "#ffffff", lineHeight: 1.45, shrink: true }),
      ...pill(64, 706, 250, 58, solid("#ffffff"), t("studio.tpl.social.linkInBio"), { font: FONTS.montserrat, size: 16, bold: true, color: blue, spacing: 1, upper: true }, { preset: "lifted", tint: "#1e1b4b" }),
      text(340, 706, 406, 58, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 18, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function giveawayPost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const plum = "#4c1d95";
  const magenta = "#be185d";
  const yellow = "#fde047";
  const steps = ["studio.tpl.social.step1", "studio.tpl.social.step2", "studio.tpl.social.step3"];
  return design(t("studio.templates.items.giveawayPost"), [plum, magenta, "#c2410c", yellow, "#ffffff"], [
    pageOf(SQUARE, gradient(160, [plum, magenta, "#c2410c"]), [
      art("sunburst", { primary: "#ffffff", secondary: yellow }, 0, 0, page.width, page.height, { opacity: 0.08 }),
      art("confetti", { primary: yellow, secondary: "#ffffff" }, 0, 0, page.width, page.height, { opacity: 0.4 }),
      centredText(page, 24, 150, t("studio.tpl.social.giveawayTitle"), { font: FONTS.bebas, size: 168, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true, inset: 40, shadow: "deep" }),
      box("rect", 145, 184, 520, 46, solid("#ffffff"), { radius: 23, opacity: 0.16 }),
      text(165, 184, 480, 46, t("studio.tpl.social.giveawayLead"), { font: FONTS.montserrat, size: 19, bold: true, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      orb(215, 208, 380, yellow, magenta, 0.35),
      shadowed(box("ellipse", 265, 254, 280, 280, gradient(135, [yellow, "#f472b6"])), "glow", yellow),
      ...slot(279, 268, 252, 252, "#fbcfe8", { circle: true }),
      shadowed(box("burst", 510, 238, 132, 132, solid(yellow), { rotation: 12, points: 16, inner: 0.84 }), "lifted", "#000000"),
      text(528, 278, 96, 52, t("studio.tpl.win"), { font: FONTS.montserrat, size: 24, bold: true, color: "#831843", align: "center", valign: "middle", rotation: 12, shrink: true }),
      ...steps.flatMap((key, index) => {
        const x = 48 + index * 246;
        return [
          shadowed(box("rect", x, 572, 222, 128, solid("#ffffff"), { radius: 24 }), "lifted", "#000000"),
          box("ellipse", x + 86, 546, 50, 50, gradient(135, [plum, magenta]), { stroke: stroke("#ffffff", 4) }),
          text(x + 86, 546, 50, 50, String(index + 1), { font: FONTS.montserrat, size: 22, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x + 16, 602, 190, 86, t(key), { font: FONTS.montserrat, size: 17, bold: true, color: plum, align: "center", valign: "middle", lineHeight: 1.25, shrink: true }),
        ];
      }),
      centredText(page, 720, 28, t("studio.tpl.social.giveawayEnds"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true, inset: 48 }),
      centredText(page, 756, 28, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 16, bold: true, color: "#ffffff", spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function tipsCarousel({ t }: TemplateContext) {
  const page = PORTRAIT;
  const ink = "#172554";
  const coral = "#e11d48";
  const flame = "#ea580c";
  const peach = "#fdba74";
  const cream = "#fff7ed";
  const hot = gradient(135, [coral, flame]);
  const tips = ["studio.tpl.social.tip1", "studio.tpl.social.tip2", "studio.tpl.social.tip3", "studio.tpl.social.tip4", "studio.tpl.social.tip5"];
  const footer = (color: string): StudioElement[] => [
    text(64, 880, 320, 50, t("studio.tpl.social.handle"), { font: FONTS.inter, size: 17, bold: true, color, valign: "middle", shrink: true }),
    text(430, 880, 236, 50, t("studio.tpl.social.swipe"), { font: FONTS.inter, size: 16, bold: true, color, align: "right", valign: "middle", spacing: 3, upper: true, shrink: true }),
    shadowed(box("arrow", 682, 887, 64, 36, hot), "soft", coral),
  ];
  return design(t("studio.templates.items.tipsCarousel"), [ink, coral, flame, peach, cream], [
    pageOf(PORTRAIT, gradient(160, [cream, "#ffe4e6"]), [
      art("blob", { primary: "#fda4af", secondary: peach }, 420, -170, 540, 540, { opacity: 0.9 }),
      art("halftone", { primary: coral, secondary: flame }, 470, 620, 340, 392, { opacity: 0.18 }),
      text(440, 0, 320, 400, "5", { font: FONTS.poppins, size: 380, bold: true, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1, opacity: 0.5 }),
      ...pill(64, 176, 240, 44, solid(ink), t("studio.tpl.social.tipsKicker"), { font: FONTS.inter, size: 14, bold: true, color: "#ffffff", spacing: 2, upper: true }, { preset: "soft" }),
      text(64, 248, 620, 372, t("studio.tpl.social.tipsTitle"), { font: FONTS.poppins, size: 66, bold: true, color: ink, lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 64, 652, 104, 10, hot, { radius: 5 }),
      text(64, 688, 560, 84, t("studio.tpl.social.tipsLead"), { font: FONTS.inter, size: 22, color: "#475569", lineHeight: 1.4, shrink: true }),
      ...footer(ink),
      ...progressDots(page.width / 2, 960, 3, 0, coral, "#fecdd3"),
    ]),
    pageOf(PORTRAIT, gradient(180, [cream, "#ffedd5"]), [
      art("blob", { primary: "#fecdd3", secondary: peach }, 600, -110, 300, 300, { opacity: 0.9 }),
      text(64, 64, 560, 84, t("studio.tpl.social.tipsListTitle"), { font: FONTS.poppins, size: 42, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", 64, 160, 88, 8, hot, { radius: 4 }),
      ...tips.flatMap((key, index) => {
        const y = 204 + index * 128;
        return [
          shadowed(box("rect", 64, y, 682, 108, solid("#ffffff"), { radius: 22 }), "soft", ink),
          box("ellipse", 88, y + 24, 60, 60, hot),
          text(88, y + 24, 60, 60, String(index + 1), { font: FONTS.poppins, size: 24, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(172, y + 10, 550, 88, t(key), { font: FONTS.poppins, size: 20, bold: true, color: ink, lineHeight: 1.25, valign: "middle", shrink: true }),
        ];
      }),
      ...footer(ink),
      ...progressDots(page.width / 2, 960, 3, 1, coral, "#fecdd3"),
    ]),
    pageOf(PORTRAIT, gradient(160, [ink, "#1e1b4b"]), [
      art("halftone", { primary: "#ffffff", secondary: peach }, 0, 0, page.width, page.height, { opacity: 0.05 }),
      orb(155, 60, 500, coral, ink, 0.5),
      art("arcRings", { primary: "#fb7185", secondary: peach }, 205, 110, 400, 400, { opacity: 0.85 }),
      shadowed(box("heart", 330, 245, 150, 135, hot), "glow", coral),
      centredText(page, 560, 150, t("studio.tpl.social.tipsCtaTitle"), { font: FONTS.poppins, size: 56, bold: true, color: "#ffffff", lineHeight: 1.1, valign: "middle", shrink: true, inset: 80 }),
      centredText(page, 718, 72, t("studio.tpl.social.tipsCtaLead"), { font: FONTS.inter, size: 21, color: "#cbd5e1", lineHeight: 1.4, shrink: true, inset: 110 }),
      ...pill(195, 812, 420, 66, hot, t("studio.tpl.social.followForMore"), { font: FONTS.inter, size: 19, bold: true, color: "#ffffff", spacing: 1, upper: true }, { preset: "glow", tint: coral }),
      centredText(page, 896, 30, t("studio.tpl.social.handle"), { font: FONTS.inter, size: 17, bold: true, color: peach, valign: "middle", shrink: true }),
      ...progressDots(page.width / 2, 960, 3, 2, "#ffffff", "#3b4c85"),
    ]),
  ]);
}

function reviewPost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const indigo = "#4338ca";
  const pink = "#ec4899";
  const amber = "#f59e0b";
  return design(t("studio.templates.items.reviewPost"), [indigo, pink, amber, "#1e1b4b", "#ffffff"], [
    pageOf(SQUARE, gradient(135, ["#eef2ff", "#fdf2f8", "#fff7ed"]), [
      art("marble", { primary: "#c7d2fe", secondary: "#fbcfe8" }, 0, 0, page.width, page.height, { opacity: 0.35 }),
      art("blob", { primary: "#c7d2fe", secondary: "#fbcfe8" }, 540, -120, 380, 380, { opacity: 0.8 }),
      art("arcRings", { primary: "#a5b4fc", secondary: "#f9a8d4" }, -130, 520, 380, 380, { opacity: 0.6 }),
      centredText(page, 44, 28, t("studio.tpl.social.reviewKicker"), { font: FONTS.montserrat, size: 15, bold: true, color: indigo, spacing: 4, upper: true, valign: "middle", shrink: true }),
      shadowed(box("rect", 80, 168, 650, 536, solid("#ffffff"), { radius: 36 }), "lifted", indigo),
      text(108, 196, 140, 140, "“", { font: FONTS.lora, size: 200, bold: true, color: indigo, lineHeight: 1, opacity: 0.14 }),
      shadowed(box("ellipse", 343, 98, 124, 124, gradient(135, [indigo, pink])), "lifted", indigo),
      ...slot(351, 106, 108, 108, "#e0e7ff", { circle: true }),
      ...Array.from({ length: 5 }, (_, index) => box("star", 300 + index * 44, 248, 34, 34, gradient(160, ["#fbbf24", amber]))),
      text(130, 300, 550, 236, t("studio.tpl.social.reviewText"), { font: FONTS.lora, size: 28, italic: true, color: "#1e1b4b", align: "center", valign: "middle", lineHeight: 1.45, shrink: true }),
      box("rect", page.width / 2 - 32, 560, 64, 4, gradient(0, [indigo, pink]), { radius: 2 }),
      centredText(page, 582, 32, t("studio.tpl.social.reviewName"), { font: FONTS.montserrat, size: 20, bold: true, color: indigo, valign: "middle", shrink: true, inset: 140 }),
      centredText(page, 618, 26, t("studio.tpl.social.reviewRole"), { font: FONTS.montserrat, size: 14, color: "#6b7280", valign: "middle", shrink: true, inset: 140 }),
      ...pill(page.width / 2 - 140, 732, 280, 46, gradient(90, [indigo, "#6d28d9"]), t("studio.tpl.website"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", spacing: 1 }, { preset: "soft", tint: indigo }),
    ]),
  ]);
}

function eventStory({ t }: TemplateContext) {
  const page = sizeOf(STORY);
  const night = "#0f0a1e";
  const rose = "#f43f5e";
  const orange = "#f97316";
  const blush = "#f9a8d4";
  const hot = gradient(135, [rose, orange]);
  return design(t("studio.templates.items.eventStory"), [night, "#3b0764", rose, orange, blush], [
    pageOf(STORY, radial("#3b0764", night, { cy: 0.62, radius: 1 }), [
      orb(-260, 620, 780, "#db2777", night, 0.45),
      orb(420, 1080, 600, "#7c3aed", night, 0.4),
      art("confetti", { primary: blush, secondary: "#fbbf24" }, 0, 820, page.width, 620, { opacity: 0.22 }),
      ...slot(48, 48, 714, 760, "#4c1d95", { radius: 36, shadow: "lifted", tint: "#000000" }),
      shadowed(box("rect", 584, 704, 168, 184, hot, { radius: 28 }), "glow", rose),
      text(584, 716, 168, 104, t("studio.tpl.social.storyEventDay"), { font: FONTS.montserrat, size: 84, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1, shrink: true }),
      text(594, 822, 148, 44, t("studio.tpl.social.storyEventMonth"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 3, upper: true, shrink: true }),
      text(64, 852, 500, 34, t("studio.tpl.youAreInvited"), { font: FONTS.montserrat, size: 20, bold: true, color: blush, spacing: 6, upper: true, valign: "middle", shrink: true }),
      text(64, 904, 682, 248, t("studio.tpl.social.storyEventTitle"), { font: FONTS.abril, size: 92, color: "#ffffff", lineHeight: 1.02, shrink: true }),
      box("ellipse", 64, 1180, 18, 18, hot),
      text(98, 1170, 648, 38, t("studio.tpl.social.storyEventTime"), { font: FONTS.montserrat, size: 21, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      box("ellipse", 64, 1226, 18, 18, hot),
      text(98, 1216, 648, 38, t("studio.tpl.social.storyEventPlace"), { font: FONTS.montserrat, size: 20, color: "#e9d5ff", valign: "middle", shrink: true }),
      ...pill(96, 1290, 618, 84, gradient(90, [rose, orange]), t("studio.tpl.social.storyEventCta"), { font: FONTS.montserrat, size: 21, bold: true, color: "#ffffff" }, { preset: "glow", tint: rose }),
      centredText(page, 1392, 28, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 17, bold: true, color: blush, spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function flashSaleStory({ t }: TemplateContext) {
  const page = sizeOf(STORY);
  const ink = "#111827";
  const yellow = "#fde047";
  const pink = "#db2777";
  const units = [
    ["studio.tpl.social.flashHours", "studio.tpl.social.hoursLabel"],
    ["studio.tpl.social.flashMinutes", "studio.tpl.social.minutesLabel"],
    ["studio.tpl.social.flashSeconds", "studio.tpl.social.secondsLabel"],
  ];
  return design(t("studio.templates.items.flashSaleStory"), [ink, pink, yellow, "#f59e0b", "#ffffff"], [
    pageOf(STORY, gradient(170, ["#fef08a", "#facc15", "#f59e0b"]), [
      art("sunburst", { primary: "#ffffff", secondary: yellow }, 0, 0, page.width, page.height, { opacity: 0.28 }),
      art("halftone", { primary: ink, secondary: ink }, 0, 1100, 360, 340, { opacity: 0.1 }),
      orb(430, -160, 560, "#ffffff", "#facc15", 0.35),
      shadowed(box("burst", 516, 76, 236, 236, gradient(135, ["#ec4899", pink]), { rotation: 10, points: 20, inner: 0.84 }), "lifted", "#7c2d12"),
      text(542, 148, 184, 92, t("studio.tpl.social.flashToday"), { font: FONTS.montserrat, size: 26, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, lineHeight: 1.1, rotation: 10, shrink: true }),
      text(60, 320, 690, 440, t("studio.tpl.social.flashTitle"), { font: FONTS.bebas, size: 260, color: ink, lineHeight: 0.82, valign: "middle", shrink: true, shadow: "subtle" }),
      shadowed(box("rect", -80, 792, 970, 170, gradient(0, ["#0b0f19", "#1f2937"]), { rotation: -6 }), "long", "#7c2d12"),
      text(60, 807, 690, 140, t("studio.tpl.social.flashOffer"), { font: FONTS.bebas, size: 120, color: yellow, align: "center", valign: "middle", rotation: -6, shrink: true }),
      centredText(page, 1004, 34, t("studio.tpl.social.flashEndsIn"), { font: FONTS.montserrat, size: 18, bold: true, color: ink, spacing: 6, upper: true, valign: "middle", shrink: true }),
      ...units.flatMap(([value, label], index) => {
        const x = 120 + index * 200;
        return [
          shadowed(box("rect", x, 1050, 170, 132, gradient(180, ["#1f2937", "#0b0f19"]), { radius: 22 }), "lifted", "#7c2d12"),
          text(x, 1058, 170, 84, t(value), { font: FONTS.bebas, size: 84, color: yellow, align: "center", valign: "middle", lineHeight: 1 }),
          text(x + 10, 1140, 150, 30, t(label), { font: FONTS.montserrat, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 2, upper: true, shrink: true }),
        ];
      }),
      shadowed(box("rect", 205, 1210, 400, 62, solid("#ffffff"), { radius: 14, stroke: stroke(ink, 2, "dashed") }), "soft"),
      text(225, 1210, 360, 62, t("studio.tpl.social.flashCode"), { font: FONTS.montserrat, size: 20, bold: true, color: ink, align: "center", valign: "middle", spacing: 2, shrink: true }),
      ...pill(185, 1296, 440, 78, gradient(90, ["#be185d", pink]), t("studio.tpl.shopNow"), { font: FONTS.montserrat, size: 24, bold: true, color: "#ffffff", spacing: 3, upper: true }, { preset: "glow", tint: pink }),
      centredText(page, 1392, 28, t("studio.tpl.website"), { font: FONTS.montserrat, size: 16, bold: true, color: ink, valign: "middle", shrink: true }),
    ]),
  ]);
}

function youtubeThumbnail({ t }: TemplateContext) {
  const page = THUMBNAIL;
  const yellow = "#facc15";
  const night = "#0b1225";
  const blue = "#2563eb";
  return design(t("studio.templates.items.youtubeThumbnail"), [night, blue, yellow, "#ffffff"], [
    pageOf(THUMBNAIL, solid(night), [
      ...slot(500, 0, 460, page.height, "#334155"),
      box("rect", 380, -100, 200, 740, solid(night), { rotation: 12 }),
      shadowed(box("rect", 576, -100, 16, 740, gradient(90, [yellow, "#f59e0b"]), { rotation: 12 }), "glow", yellow),
      orb(-220, -180, 640, blue, night, 0.55),
      art("diagonalHatch", { primary: "#ffffff", secondary: "#ffffff" }, 0, 0, 480, page.height, { opacity: 0.05 }),
      ...pill(48, 40, 220, 44, solid(yellow), t("studio.tpl.social.thumbTag"), { font: FONTS.montserrat, size: 16, bold: true, color: night, spacing: 2, upper: true }, { preset: "glow", tint: yellow }),
      text(48, 104, 470, 132, t("studio.tpl.social.thumbTitle"), { font: FONTS.bebas, size: 74, color: "#ffffff", lineHeight: 0.92, valign: "bottom", shrink: true, shadow: "deep" }),
      shadowed(box("rect", 40, 254, 476, 126, gradient(100, [yellow, "#fde047"]), { radius: 10, rotation: -3 }), "long", "#000000"),
      text(60, 258, 436, 118, t("studio.tpl.social.thumbHighlight"), { font: FONTS.bebas, size: 124, color: night, align: "center", valign: "middle", lineHeight: 0.9, rotation: -3, shrink: true }),
      text(48, 410, 380, 80, t("studio.tpl.social.thumbLead"), { font: FONTS.montserrat, size: 24, bold: true, color: "#ffffff", lineHeight: 1.15, valign: "middle", shrink: true }),
      shadowed(box("arrow", 438, 412, 120, 62, solid(yellow), { rotation: -20 }), "glow", yellow),
    ]),
  ]);
}

function linkedinBanner({ t }: TemplateContext) {
  const navy = "#0b1e4a";
  const blue = "#1d4ed8";
  const sky = "#38bdf8";
  return design(t("studio.templates.items.linkedinBanner"), [navy, "#1e3a8a", blue, sky, "#ffffff"], [
    pageOf(BANNER, gradient(120, [navy, "#1e3a8a", blue]), [
      art("topographic", { primary: "#60a5fa", secondary: "#93c5fd" }, 0, 0, BANNER.width, BANNER.height, { opacity: 0.16 }),
      orb(840, -200, 560, sky, blue, 0.45),
      orb(-160, 60, 420, "#6366f1", navy, 0.35),
      art("arcRings", { primary: sky, secondary: "#ffffff" }, 1010, 120, 230, 230, { opacity: 0.35 }),
      text(330, 52, 480, 24, t("studio.tpl.social.bannerKicker"), { font: FONTS.inter, size: 13, bold: true, color: "#7dd3fc", spacing: 3, upper: true, valign: "middle", shrink: true }),
      text(330, 84, 480, 104, t("studio.tpl.social.bannerTitle"), { font: FONTS.poppins, size: 31, bold: true, color: "#ffffff", lineHeight: 1.15, valign: "middle", shrink: true }),
      box("rect", 330, 204, 64, 5, gradient(0, [sky, "#a5f3fc"]), { radius: 2.5 }),
      text(330, 224, 210, 26, t("studio.tpl.website"), { font: FONTS.inter, size: 14, bold: true, color: "#dbeafe", valign: "middle", shrink: true }),
      text(552, 224, 240, 26, t("studio.tpl.email"), { font: FONTS.inter, size: 14, color: "#dbeafe", valign: "middle", shrink: true }),
      ...pill(868, 110, 270, 76, solid("#ffffff"), t("studio.tpl.social.bannerCta"), { font: FONTS.poppins, size: 20, bold: true, color: blue }, { preset: "lifted", tint: "#000000" }),
    ]),
  ]);
}

function pinterestPin({ t }: TemplateContext) {
  const page = PIN;
  const terracotta = "#c2410c";
  const ink = "#292524";
  const sand = "#e7d8c9";
  return design(t("studio.templates.items.pinterestPin"), [terracotta, ink, sand, "#f7f1ea", "#ffffff"], [
    pageOf(PIN, gradient(180, ["#f7f1ea", "#efe4d6"]), [
      ...slot(0, 0, page.width, 560, sand),
      art("halftone", { primary: terracotta, secondary: "#ea580c" }, 0, 760, page.width, 365, { opacity: 0.1 }),
      shadowed(box("rect", 56, 440, 638, 316, solid("#ffffff"), { radius: 24 }), "lifted", "#3b2a1e"),
      box("rect", 72, 456, 606, 284, { type: "none" }, { radius: 16, stroke: stroke(sand, 1.5) }),
      art("botanicalSprig", { primary: terracotta, secondary: sand }, 600, 380, 70, 140, { rotation: 24, opacity: 0.85 }),
      centredText(page, 478, 28, t("studio.tpl.social.pinKicker"), { font: FONTS.montserrat, size: 13, bold: true, color: terracotta, spacing: 5, upper: true, valign: "middle", shrink: true, inset: 110 }),
      centredText(page, 514, 156, t("studio.tpl.social.pinTitle"), { font: FONTS.playfair, size: 44, bold: true, color: ink, lineHeight: 1.12, valign: "middle", shrink: true, inset: 104 }),
      art("diamondDivider", { primary: terracotta, secondary: sand }, page.width / 2 - 100, 676, 200, 14),
      centredText(page, 698, 30, t("studio.tpl.social.pinLead"), { font: FONTS.playfair, size: 18, italic: true, color: "#57534e", valign: "middle", shrink: true, inset: 110 }),
      ...slot(56, 792, 307, 240, sand, { radius: 20, shadow: "soft", tint: "#3b2a1e" }),
      ...slot(387, 792, 307, 240, sand, { radius: 20, shadow: "soft", tint: "#3b2a1e" }),
      rule(page.width / 2 - 150, 1074, 60, terracotta, 1.2),
      rule(page.width / 2 + 90, 1074, 60, terracotta, 1.2),
      centredText(page, 1058, 32, t("studio.tpl.website"), { font: FONTS.montserrat, size: 14, bold: true, color: ink, spacing: 2, valign: "middle", shrink: true, inset: 230 }),
    ]),
  ]);
}

function editorialQuote({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const wine = "#6d1a2d";
  const ink = "#2b1a14";
  const muted = "#6b5a4e";
  const cream = "#f8f3ea";
  const left = 120;
  return design(t("studio.templates.items.editorialQuote"), [wine, ink, "#b8893b", cream], [
    pageOf(SQUARE, gradient(160, [cream, "#efe4d3"]), [
      art("marble", { primary: "#e4d6c1", secondary: "#d9c3a5" }, 0, 0, page.width, page.height, { opacity: 0.35 }),
      art("guillocheRosette", { primary: wine, secondary: "#b8893b" }, 470, -150, 480, 480, { opacity: 0.08 }),
      box("rect", 0, 0, 64, page.height, gradient(180, [wine, "#3f0d19"])),
      box("rect", 64, 0, 3, page.height, foil("gold", 90)),
      art("botanicalSprig", { primary: wine, secondary: "#b8893b" }, 680, 56, 72, 144, { rotation: 18, opacity: 0.45 }),
      text(left, 88, 420, 24, t("studio.tpl.editorialQuoteKicker"), { font: FONTS.josefin, size: 14, bold: true, color: wine, spacing: 5, upper: true, valign: "middle", shrink: true }),
      box("rect", left, 124, 48, 2, foil("gold", 0)),
      text(left - 14, 120, 220, 220, "“", { font: FONTS.cormorant, size: 300, bold: true, color: wine, lineHeight: 1 }),
      text(left, 258, 600, 284, t("studio.tpl.editorialQuoteText"), { font: FONTS.cormorant, size: 56, bold: true, italic: true, color: ink, lineHeight: 1.08, valign: "middle", shrink: true }),
      box("rect", left, 572, 80, 2, foil("gold", 0)),
      shadowed(box("ellipse", 596, 560, 140, 140, foil("gold", 135)), "lifted", "#3f0d19"),
      ...slot(604, 568, 124, 124, "#d9c3a5", { circle: true }),
      text(left, 596, 440, 32, t("studio.tpl.editorialQuoteAuthor"), { font: FONTS.josefin, size: 20, bold: true, color: ink, spacing: 3, upper: true, valign: "middle", shrink: true }),
      text(left, 632, 440, 26, t("studio.tpl.editorialQuoteRole"), { font: FONTS.josefin, size: 15, color: muted, valign: "middle", shrink: true }),
      rule(left, 728, 610, "#cdb9a0", 1),
      text(left, 742, 360, 32, t("studio.tpl.social.handle"), { font: FONTS.josefin, size: 15, bold: true, color: wine, spacing: 2, valign: "middle", shrink: true }),
      art("diamondDivider", { primary: "#b8893b", secondary: wine }, 610, 752, 120, 12),
    ]),
  ]);
}

function carouselCover({ t }: TemplateContext) {
  const page = PORTRAIT;
  const night = "#101114";
  const lime = "#d4ff3f";
  const grey = "#a1a7b3";
  return design(t("studio.templates.items.carouselCover"), [night, lime, "#2b2f37", "#ffffff"], [
    pageOf(PORTRAIT, gradient(165, ["#1a1c22", "#0b0c0f"]), [
      art("topographic", { primary: "#2a2f38", secondary: "#3a4150" }, 0, 0, page.width, page.height, { opacity: 0.5 }),
      orb(-260, 520, 640, "#3d4a12", night, 0.35),
      box("rect", 776, 196, 120, 620, solid("#2b2f37"), { radius: 24 }),
      shadowed(box("rect", 748, 168, 140, 676, gradient(160, [lime, "#a3e635"]), { radius: 28 }), "lifted", "#000000"),
      text(330, 96, 380, 300, "07", { font: FONTS.oswald, size: 290, bold: true, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1, opacity: 0.06 }),
      box("ellipse", 60, 60, 72, 72, solid(lime)),
      ...slot(64, 64, 64, 64, "#2b2f37", { circle: true }),
      text(148, 66, 340, 28, t("studio.tpl.personName"), { font: FONTS.inter, size: 18, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(148, 96, 340, 24, t("studio.tpl.social.handle"), { font: FONTS.inter, size: 15, color: grey, valign: "middle", shrink: true }),
      box("rect", 572, 74, 112, 44, { type: "none" }, { radius: 22, stroke: stroke(lime, 1.5) }),
      text(572, 74, 112, 44, "01 / 07", { font: FONTS.inter, size: 15, bold: true, color: lime, align: "center", valign: "middle", spacing: 1 }),
      ...pill(64, 296, 280, 48, solid(lime), t("studio.tpl.carouselCoverKicker"), { font: FONTS.inter, size: 15, bold: true, color: night, spacing: 2, upper: true }),
      text(64, 372, 640, 384, t("studio.tpl.carouselCoverTitle"), { font: FONTS.oswald, size: 88, bold: true, color: "#ffffff", upper: true, lineHeight: 1.02, valign: "bottom", shrink: true }),
      box("rect", 64, 780, 136, 10, gradient(0, [lime, "#a3e635"]), { radius: 5 }),
      text(64, 808, 620, 56, t("studio.tpl.carouselCoverLead"), { font: FONTS.inter, size: 28, color: "#e5e7eb", valign: "middle", shrink: true }),
      rule(64, 900, 620, "#2e333c", 1),
      text(64, 920, 300, 48, t("studio.tpl.carouselCoverSave"), { font: FONTS.inter, size: 15, bold: true, color: grey, spacing: 2, upper: true, valign: "middle", shrink: true }),
      text(380, 920, 220, 48, t("studio.tpl.social.swipe"), { font: FONTS.inter, size: 17, bold: true, color: lime, align: "right", spacing: 3, upper: true, valign: "middle", shrink: true }),
      shadowed(box("arrow", 616, 926, 68, 36, solid(lime)), "glow", lime),
    ]),
  ]);
}

function productShowcase({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const ink = "#2b1a12";
  const clay = "#8a4b2f";
  const sand = "#e6cbb8";
  const specs = ["studio.tpl.productShowcaseSpec1", "studio.tpl.productShowcaseSpec2", "studio.tpl.productShowcaseSpec3"];
  return design(t("studio.templates.items.productShowcase"), [ink, clay, sand, "#fbf3ec"], [
    pageOf(SQUARE, radial("#fdf7f1", "#efdccd", { cy: 0.4, radius: 1 }), [
      art("arcRings", { primary: "#e7c9b4", secondary: "#d9a98a" }, 165, 70, 480, 480, { opacity: 0.55 }),
      box("ellipse", 215, 120, 380, 380, gradient(160, ["#f3dccb", "#e2b99e"])),
      art("botanicalSprig", { primary: "#7d8b5c", secondary: "#c9a27e" }, 150, 300, 96, 192, { rotation: -20, opacity: 0.9 }),
      art("botanicalSprig", { primary: "#7d8b5c", secondary: "#c9a27e" }, 580, 330, 70, 140, { rotation: 24, opacity: 0.75 }),
      shadowed(box("rect", 255, 474, 300, 72, gradient(90, ["#d2a98e", "#efd6c4", "#d2a98e"])), "lifted", "#5b3a29"),
      box("ellipse", 255, 456, 300, 36, solid("#f7e7da")),
      ...slot(305, 150, 200, 320, "#e9cdb9", { radius: 100, shadow: "lifted", tint: "#5b3a29" }),
      shadowed(box("ellipse", 530, 126, 128, 128, gradient(135, [ink, "#4a2c1e"]), { stroke: stroke("#f7e7da", 4) }), "lifted", "#5b3a29"),
      text(540, 160, 108, 60, t("studio.tpl.productShowcasePrice"), { font: FONTS.playfair, size: 32, bold: true, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      centredText(page, 44, 28, t("studio.tpl.productShowcaseKicker"), { font: FONTS.raleway, size: 14, bold: true, color: clay, spacing: 5, upper: true, valign: "middle", shrink: true }),
      centredText(page, 560, 64, t("studio.tpl.productShowcaseName"), { font: FONTS.playfair, size: 46, bold: true, color: ink, valign: "middle", shrink: true, inset: 64 }),
      centredText(page, 624, 30, t("studio.tpl.productShowcaseLead"), { font: FONTS.raleway, size: 18, color: "#6b4f42", valign: "middle", shrink: true, inset: 80 }),
      ...specs.flatMap((key, index) => {
        const x = 89 + index * 216;
        return [box("rect", x, 674, 200, 40, solid("#ffffff"), { radius: 20, stroke: stroke(sand, 1.2) }), text(x + 16, 674, 168, 40, t(key), { font: FONTS.raleway, size: 14, bold: true, color: "#5b3a29", align: "center", valign: "middle", shrink: true })];
      }),
      ...pill(285, 736, 240, 50, gradient(90, [ink, "#4a2c1e"]), t("studio.tpl.shopNow"), { font: FONTS.raleway, size: 15, bold: true, color: "#ffffff", spacing: 3, upper: true }, { preset: "lifted", tint: "#5b3a29" }),
    ]),
  ]);
}

function eventCountdown({ t }: TemplateContext) {
  const page = sizeOf(STORY);
  const cobalt = "#1238c9";
  const navy = "#0a1f7a";
  const flame = gradient(135, ["#ea580c", "#be123c"]);
  return design(t("studio.templates.items.eventCountdown"), [cobalt, navy, "#ea580c", "#be123c", "#ffffff"], [
    pageOf(STORY, gradient(170, [cobalt, navy]), [
      art("sunburst", { primary: "#ffffff", secondary: "#93c5fd" }, -315, -110, 1440, 1440, { opacity: 0.08 }),
      art("halftone", { primary: "#ffffff", secondary: "#ffffff" }, 0, 1160, page.width, 280, { opacity: 0.08 }),
      orb(-200, -200, 560, "#3b82f6", cobalt, 0.4),
      box("rect", 185, 108, 440, 56, { type: "none" }, { radius: 28, stroke: stroke("#ffffff", 1.5) }),
      text(205, 108, 400, 56, t("studio.tpl.eventCountdownKicker"), { font: FONTS.inter, size: 17, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 3, upper: true, shrink: true }),
      art("arcRings", { primary: "#ffffff", secondary: "#fdba74" }, 95, 200, 620, 620, { opacity: 0.55 }),
      box("ellipse", 155, 260, 500, 500, { type: "none" }, { stroke: stroke("#ffffff", 2, "dashed"), opacity: 0.4 }),
      shadowed(box("ellipse", 205, 310, 400, 400, flame), "glow", "#f97316"),
      text(205, 310, 400, 400, "3", { font: FONTS.poppins, size: 300, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1 }),
      centredText(page, 790, 72, t("studio.tpl.eventCountdownDays"), { font: FONTS.poppins, size: 54, bold: true, color: "#ffffff", spacing: 4, upper: true, valign: "middle", shrink: true, inset: 64 }),
      art("dotsDivider", { primary: "#ffffff", secondary: "#fdba74" }, page.width / 2 - 60, 878, 120, 10),
      centredText(page, 904, 140, t("studio.tpl.eventName"), { font: FONTS.poppins, size: 60, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "middle", shrink: true, inset: 72 }),
      shadowed(box("rect", 96, 1066, 618, 172, solid("#ffffff"), { radius: 28 }), "lifted", "#020617"),
      box("ellipse", 136, 1102, 16, 16, flame),
      text(166, 1088, 520, 44, t("studio.tpl.eventCountdownDate"), { font: FONTS.inter, size: 24, bold: true, color: navy, valign: "middle", shrink: true }),
      rule(136, 1152, 538, "#dbe3ff", 1.2),
      box("ellipse", 136, 1184, 16, 16, flame),
      text(166, 1170, 520, 44, t("studio.tpl.eventCountdownPlace"), { font: FONTS.inter, size: 21, color: "#334155", valign: "middle", shrink: true }),
      ...pill(175, 1272, 460, 80, flame, t("studio.tpl.eventCountdownCta"), { font: FONTS.poppins, size: 22, bold: true, color: "#ffffff", spacing: 1, upper: true }, { preset: "glow", tint: "#f97316" }),
      centredText(page, 1376, 32, t("studio.tpl.social.handle"), { font: FONTS.inter, size: 17, bold: true, color: "#dbe3ff", valign: "middle", shrink: true }),
    ]),
  ]);
}

function testimonialCard({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const forest = "#2f4f3a";
  const deep = "#1b2a1f";
  const gold = "#d9a441";
  const paper = "#fbf8ef";
  const muted = "#5a6a5e";
  const left = 404;
  const column = 342;
  return design(t("studio.templates.items.testimonialCard"), [forest, gold, deep, paper], [
    pageOf(SQUARE, gradient(180, [paper, "#f1ecdc"]), [
      art("halftone", { primary: forest, secondary: gold }, 560, 520, 250, 290, { opacity: 0.12 }),
      art("botanicalSprig", { primary: forest, secondary: gold }, 690, 40, 80, 160, { rotation: 20, opacity: 0.35 }),
      ...slot(0, 0, 340, page.height, "#c9d3c3"),
      box("rect", 24, 24, 292, page.height - 48, { type: "none" }, { stroke: stroke("#ffffff", 1.5), opacity: 0.7 }),
      box("rect", 340, 0, 4, page.height, foil("gold", 90)),
      shadowed(box("ellipse", 290, 88, 104, 104, gradient(135, [forest, deep]), { stroke: stroke(paper, 6) }), "lifted", deep),
      text(290, 88, 104, 104, "“", { font: FONTS.merriweather, size: 80, bold: true, color: gold, align: "center", valign: "middle", lineHeight: 1 }),
      text(left, 220, column, 24, t("studio.tpl.testimonialCardKicker"), { font: FONTS.inter, size: 13, bold: true, color: forest, spacing: 4, upper: true, valign: "middle", shrink: true }),
      ...Array.from({ length: 5 }, (_, index) => box("star", left + index * 36, 258, 28, 28, gradient(160, ["#f1c25b", gold]))),
      text(left, 308, column, 264, t("studio.tpl.testimonialCardText"), { font: FONTS.merriweather, size: 28, italic: true, color: deep, lineHeight: 1.5, shrink: true }),
      box("rect", left, 594, 56, 3, foil("gold", 0)),
      text(left, 614, column, 32, t("studio.tpl.testimonialCardName"), { font: FONTS.inter, size: 21, bold: true, color: forest, valign: "middle", shrink: true }),
      text(left, 648, column, 26, t("studio.tpl.testimonialCardRole"), { font: FONTS.inter, size: 15, color: muted, valign: "middle", shrink: true }),
      rule(left, 712, column, "#d9d2bc", 1),
      text(left, 728, 120, 44, "5.0", { font: FONTS.merriweather, size: 28, bold: true, color: forest, valign: "middle" }),
      text(left + 130, 728, column - 130, 44, t("studio.tpl.social.handle"), { font: FONTS.inter, size: 15, bold: true, color: muted, align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

export const SOCIAL_TEMPLATES: StudioTemplate[] = [
  { id: "quotePost", category: "social", size: SQUARE, build: quotePost },
  { id: "productSpotlight", category: "social", size: SQUARE, build: productSpotlight },
  { id: "newsPost", category: "social", size: SQUARE, build: newsPost },
  { id: "giveawayPost", category: "social", size: SQUARE, build: giveawayPost },
  { id: "tipsCarousel", category: "social", size: PORTRAIT, build: tipsCarousel },
  { id: "reviewPost", category: "social", size: SQUARE, build: reviewPost },
  { id: "eventStory", category: "social", size: STORY, build: eventStory },
  { id: "flashSaleStory", category: "social", size: STORY, build: flashSaleStory },
  { id: "youtubeThumbnail", category: "social", size: THUMBNAIL, build: youtubeThumbnail },
  { id: "linkedinBanner", category: "social", size: BANNER, build: linkedinBanner },
  { id: "pinterestPin", category: "social", size: PIN, build: pinterestPin },
  { id: "editorialQuote", category: "social", size: SQUARE, build: editorialQuote },
  { id: "carouselCover", category: "social", size: PORTRAIT, build: carouselCover },
  { id: "productShowcase", category: "social", size: SQUARE, build: productShowcase },
  { id: "eventCountdown", category: "social", size: STORY, build: eventCountdown },
  { id: "testimonialCard", category: "social", size: SQUARE, build: testimonialCard },
];
