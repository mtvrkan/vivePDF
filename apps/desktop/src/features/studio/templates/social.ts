import type { StudioElement, StudioFill } from "@/types/studio";
import { art, box, centredText, design, FONTS, linear, pageOf, photoSlot, rule, sizeOf, solid, stroke, text, type StudioTemplate, type TemplateContext, type TextOptions } from "./kit";

const SQUARE = "square" as const;
const STORY = "story" as const;
const PORTRAIT = { width: 810, height: 1012.5 };
const THUMBNAIL = { width: 960, height: 540 };
const BANNER = { width: 1188, height: 297 };
const PIN = { width: 750, height: 1125 };

function radial(inner: string, outer: string): StudioFill {
  return { type: "radial", stops: [{ offset: 0, color: inner }, { offset: 1, color: outer }] };
}

function pill(x: number, y: number, width: number, height: number, fill: string, label: string, options: TextOptions): StudioElement[] {
  return [
    box("rect", x, y, width, height, solid(fill), { radius: height / 2 }),
    text(x + height * 0.4, y, width - height * 0.8, height, label, { align: "center", valign: "middle", shrink: true, ...options }),
  ];
}

function progressDots(centre: number, y: number, count: number, active: number, on: string, off: string): StudioElement[] {
  const gap = 24;
  const start = centre - ((count - 1) * gap) / 2 - 5;
  return Array.from({ length: count }, (_, index) => box("ellipse", start + index * gap, y, 10, 10, solid(index === active ? on : off)));
}

function quotePost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const rose = "#db2777";
  const plum = "#581c87";
  return design(t("studio.templates.items.quotePost"), [rose, plum], [
    pageOf(SQUARE, linear(135, "#fdf2f8", "#ede9fe"), [
      art("blob", { primary: "#fbcfe8", secondary: "#fde68a" }, -150, -140, 480, 480, { opacity: 0.85 }),
      art("blob", { primary: "#c4b5fd", secondary: "#a5f3fc" }, 520, 500, 440, 440, { opacity: 0.6, rotation: 140 }),
      box("rect", 90, 120, 630, 570, solid("#ffffff"), { radius: 36, opacity: 0.92 }),
      centredText(page, 140, 150, t("studio.tpl.social.quoteMark"), { font: FONTS.playfair, size: 150, bold: true, color: rose, lineHeight: 1 }),
      centredText(page, 262, 250, t("studio.tpl.social.quoteText"), { font: FONTS.playfair, size: 38, italic: true, color: "#1e1b4b", lineHeight: 1.3, valign: "middle", shrink: true, inset: 130 }),
      rule(page.width / 2 - 40, 540, 80, rose, 3),
      centredText(page, 562, 28, t("studio.tpl.social.quoteAuthor"), { font: FONTS.montserrat, size: 15, bold: true, color: plum, spacing: 4, upper: true, shrink: true, inset: 130 }),
      art("dotsDivider", { primary: rose, secondary: plum }, page.width / 2 - 75, 630, 150, 10),
      centredText(page, 730, 28, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 16, bold: true, color: plum, spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function productSpotlight({ t }: TemplateContext) {
  const forest = "#064e3b";
  const emerald = "#10b981";
  const lemon = "#facc15";
  const features = ["studio.tpl.social.feature1", "studio.tpl.social.feature2", "studio.tpl.social.feature3"];
  return design(t("studio.templates.items.productSpotlight"), [forest, lemon], [
    pageOf(SQUARE, solid("#ecfdf5"), [
      art("arcRings", { primary: emerald, secondary: forest }, 365, 45, 470, 470, { opacity: 0.55 }),
      box("ellipse", 390, 70, 420, 420, solid("#a7f3d0")),
      ...photoSlot(420, 100, 360, 360, "#6ee7b7", "circle"),
      box("burst", 610, 400, 160, 160, solid(lemon), { rotation: 12, points: 18, inner: 0.82 }),
      text(625, 445, 130, 70, t("studio.tpl.social.productBadge"), { font: FONTS.bebas, size: 40, color: forest, align: "center", valign: "middle", lineHeight: 0.95, rotation: 12, shrink: true }),
      ...pill(60, 80, 200, 42, forest, t("studio.tpl.social.productTag"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", spacing: 2, upper: true }),
      text(60, 140, 330, 220, t("studio.tpl.social.productName"), { font: FONTS.poppins, size: 50, bold: true, color: forest, lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 60, 380, 70, 7, solid(emerald), { radius: 3.5 }),
      text(60, 405, 320, 100, t("studio.tpl.social.productLead"), { font: FONTS.inter, size: 17, color: "#1f2937", lineHeight: 1.45, shrink: true }),
      text(60, 530, 330, 80, t("studio.tpl.social.productPrice"), { font: FONTS.bebas, size: 76, color: forest, valign: "middle", shrink: true }),
      ...pill(460, 545, 290, 64, forest, t("studio.tpl.shopNow"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff", spacing: 2, upper: true }),
      box("rect", 0, 690, 810, 120, solid(forest)),
      ...features.flatMap((key, index) => {
        const x = 40 + index * 250;
        return [
          box("ellipse", x, 740, 16, 16, solid(lemon)),
          text(x + 26, 725, 210, 46, t(key), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
        ];
      }),
    ]),
  ]);
}

function newsPost({ t }: TemplateContext) {
  const yellow = "#facc15";
  const blue = "#1d4ed8";
  return design(t("studio.templates.items.newsPost"), [blue, yellow], [
    pageOf(SQUARE, linear(135, "#2563eb", "#7c3aed"), [
      art("confetti", { primary: "#ffffff", secondary: "#a5f3fc" }, 0, 0, 810, 810, { opacity: 0.22 }),
      box("ellipse", 520, -160, 460, 460, solid("#ffffff"), { opacity: 0.08 }),
      box("ellipse", -180, 560, 420, 420, solid("#ffffff"), { opacity: 0.08 }),
      box("speech", 70, 80, 290, 110, solid(yellow), { radius: 22 }),
      text(84, 80, 262, 88, t("studio.tpl.social.newsKicker"), { font: FONTS.montserrat, size: 22, bold: true, color: "#1e1b4b", align: "center", valign: "middle", spacing: 2, upper: true, shrink: true }),
      text(70, 220, 670, 300, t("studio.tpl.social.newsTitle"), { font: FONTS.bebas, size: 110, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true }),
      box("rect", 70, 538, 110, 10, solid(yellow), { radius: 5 }),
      text(70, 568, 620, 100, t("studio.tpl.social.newsBody"), { font: FONTS.inter, size: 21, color: "#e0e7ff", lineHeight: 1.45, shrink: true }),
      ...pill(70, 700, 240, 56, "#ffffff", t("studio.tpl.social.linkInBio"), { font: FONTS.montserrat, size: 17, bold: true, color: blue, spacing: 1, upper: true }),
      text(330, 700, 410, 56, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 18, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

function giveawayPost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const pink = "#db2777";
  const yellow = "#fde047";
  const steps = ["studio.tpl.social.step1", "studio.tpl.social.step2", "studio.tpl.social.step3"];
  return design(t("studio.templates.items.giveawayPost"), [pink, yellow], [
    pageOf(SQUARE, linear(160, "#fb7185", "#f97316"), [
      art("confetti", { primary: yellow, secondary: "#ffffff" }, 0, 0, page.width, page.height, { opacity: 0.55 }),
      centredText(page, 30, 150, t("studio.tpl.social.giveawayTitle"), { font: FONTS.bebas, size: 160, color: "#ffffff", lineHeight: 0.9, valign: "middle", shrink: true, inset: 40 }),
      centredText(page, 200, 36, t("studio.tpl.social.giveawayLead"), { font: FONTS.montserrat, size: 20, bold: true, color: "#fef9c3", valign: "middle", shrink: true, inset: 60 }),
      box("ellipse", 270, 245, 270, 270, solid("#ffffff")),
      ...photoSlot(285, 260, 240, 240, "#fecdd3", "circle"),
      art("starSeal", { primary: yellow, secondary: pink }, 500, 235, 140, 140, { rotation: 12 }),
      text(522, 276, 96, 58, t("studio.tpl.win"), { font: FONTS.abril, size: 28, color: pink, align: "center", valign: "middle", rotation: 12, shrink: true }),
      ...steps.flatMap((key, index) => {
        const x = 60 + index * 240;
        return [
          box("rect", x, 545, 210, 140, solid("#ffffff"), { radius: 20 }),
          box("ellipse", x + 80, 520, 50, 50, solid(pink), { stroke: stroke("#ffffff", 4) }),
          text(x + 80, 520, 50, 50, String(index + 1), { font: FONTS.montserrat, size: 22, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
          text(x + 14, 580, 182, 92, t(key), { font: FONTS.montserrat, size: 17, bold: true, color: "#831843", align: "center", valign: "middle", lineHeight: 1.25, shrink: true }),
        ];
      }),
      centredText(page, 712, 30, t("studio.tpl.social.giveawayEnds"), { font: FONTS.inter, size: 15, bold: true, color: "#ffffff", valign: "middle", shrink: true, inset: 50 }),
      centredText(page, 752, 28, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 16, bold: true, color: yellow, valign: "middle", shrink: true }),
    ]),
  ]);
}

function tipsCarousel({ t }: TemplateContext) {
  const page = PORTRAIT;
  const ink = "#172c66";
  const pink = "#f582ae";
  const teal = "#8bd3dd";
  const cream = "#fef6e4";
  const tips = ["studio.tpl.social.tip1", "studio.tpl.social.tip2", "studio.tpl.social.tip3", "studio.tpl.social.tip4", "studio.tpl.social.tip5"];
  const footer = (color: string, accent: string): StudioElement[] => [
    text(64, 880, 320, 50, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 17, bold: true, color, valign: "middle", shrink: true }),
    text(440, 880, 230, 50, t("studio.tpl.social.swipe"), { font: FONTS.montserrat, size: 17, bold: true, color, align: "right", valign: "middle", spacing: 2, upper: true, shrink: true }),
    box("arrow", 684, 885, 62, 40, solid(accent)),
  ];
  return design(t("studio.templates.items.tipsCarousel"), [ink, pink, teal], [
    pageOf(PORTRAIT, solid(cream), [
      art("blob", { primary: teal, secondary: pink }, 470, -130, 470, 470, { opacity: 0.85 }),
      box("ellipse", -130, 760, 320, 320, solid("#f3d2c1")),
      ...pill(64, 180, 230, 44, ink, t("studio.tpl.social.tipsKicker"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", spacing: 2, upper: true }),
      text(64, 250, 620, 370, t("studio.tpl.social.tipsTitle"), { font: FONTS.montserrat, size: 64, bold: true, color: ink, lineHeight: 1.05, valign: "bottom", shrink: true }),
      box("rect", 64, 652, 100, 10, solid(pink), { radius: 5 }),
      text(64, 688, 560, 80, t("studio.tpl.social.tipsLead"), { font: FONTS.inter, size: 22, color: "#4b5a8a", lineHeight: 1.4, shrink: true }),
      ...footer(ink, pink),
      ...progressDots(page.width / 2, 960, 3, 0, ink, "#d6d3e0"),
    ]),
    pageOf(PORTRAIT, solid(cream), [
      art("blob", { primary: "#f3d2c1", secondary: teal }, 620, -90, 260, 260, { opacity: 0.9 }),
      text(64, 70, 560, 80, t("studio.tpl.social.tipsListTitle"), { font: FONTS.montserrat, size: 40, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", 64, 160, 80, 8, solid(pink), { radius: 4 }),
      ...tips.flatMap((key, index) => {
        const y = 205 + index * 128;
        return [
          box("rect", 64, y, 682, 108, solid("#ffffff"), { radius: 20 }),
          box("ellipse", 88, y + 24, 60, 60, solid(index % 2 ? teal : pink)),
          text(88, y + 24, 60, 60, String(index + 1), { font: FONTS.montserrat, size: 24, bold: true, color: ink, align: "center", valign: "middle" }),
          text(170, y + 10, 552, 88, t(key), { font: FONTS.montserrat, size: 20, bold: true, color: ink, lineHeight: 1.25, valign: "middle", shrink: true }),
        ];
      }),
      ...footer(ink, pink),
      ...progressDots(page.width / 2, 960, 3, 1, ink, "#d6d3e0"),
    ]),
    pageOf(PORTRAIT, solid(ink), [
      art("arcRings", { primary: pink, secondary: teal }, 205, 110, 400, 400, { opacity: 0.9 }),
      box("heart", 330, 245, 150, 135, solid(pink)),
      centredText(page, 560, 150, t("studio.tpl.social.tipsCtaTitle"), { font: FONTS.montserrat, size: 54, bold: true, color: "#ffffff", lineHeight: 1.1, valign: "middle", shrink: true, inset: 80 }),
      centredText(page, 718, 72, t("studio.tpl.social.tipsCtaLead"), { font: FONTS.inter, size: 21, color: "#dbe4ff", lineHeight: 1.4, shrink: true, inset: 110 }),
      ...pill(215, 815, 380, 64, pink, t("studio.tpl.social.followForMore"), { font: FONTS.montserrat, size: 17, bold: true, color: ink, spacing: 1, upper: true }),
      centredText(page, 896, 30, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 17, bold: true, color: teal, valign: "middle", shrink: true }),
      ...progressDots(page.width / 2, 960, 3, 2, "#ffffff", "#3b4c85"),
    ]),
  ]);
}

function reviewPost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const indigo = "#4338ca";
  const amber = "#f59e0b";
  return design(t("studio.templates.items.reviewPost"), [indigo, amber], [
    pageOf(SQUARE, radial("#f5f7ff", "#e0e7ff"), [
      art("arcRings", { primary: "#a5b4fc", secondary: "#f9a8d4" }, -120, 520, 380, 380, { opacity: 0.7 }),
      art("blob", { primary: "#c7d2fe", secondary: "#fbcfe8" }, 560, -100, 360, 360, { opacity: 0.8 }),
      centredText(page, 46, 26, t("studio.tpl.social.reviewKicker"), { font: FONTS.montserrat, size: 15, bold: true, color: indigo, spacing: 4, upper: true, valign: "middle", shrink: true }),
      box("rect", 80, 160, 650, 540, solid("#ffffff"), { radius: 32 }),
      box("ellipse", 347, 92, 116, 116, solid("#ffffff")),
      ...photoSlot(355, 100, 100, 100, "#c7d2fe", "circle"),
      ...Array.from({ length: 5 }, (_, index) => box("star", 300 + index * 44, 232, 34, 34, solid(amber))),
      text(130, 290, 550, 250, t("studio.tpl.social.reviewText"), { font: FONTS.lora, size: 28, italic: true, color: "#1e1b4b", align: "center", valign: "middle", lineHeight: 1.45, shrink: true }),
      rule(page.width / 2 - 30, 565, 60, amber, 2),
      centredText(page, 585, 30, t("studio.tpl.social.reviewName"), { font: FONTS.montserrat, size: 20, bold: true, color: indigo, valign: "middle", shrink: true, inset: 140 }),
      centredText(page, 618, 24, t("studio.tpl.social.reviewRole"), { font: FONTS.inter, size: 14, color: "#6b7280", valign: "middle", shrink: true, inset: 140 }),
      centredText(page, 736, 30, t("studio.tpl.website"), { font: FONTS.montserrat, size: 16, bold: true, color: indigo, spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function eventStory({ t }: TemplateContext) {
  const page = sizeOf(STORY);
  const ink = "#2e1065";
  const rose = "#f43f5e";
  const lilac = "#f5f3ff";
  return design(t("studio.templates.items.eventStory"), [ink, rose], [
    pageOf(STORY, solid(lilac), [
      ...photoSlot(0, 0, page.width, 800, "#ddd6fe"),
      box("ellipse", -120, 690, 1050, 400, solid(lilac)),
      box("rect", 590, 610, 160, 170, solid(rose), { radius: 24 }),
      text(590, 620, 160, 100, t("studio.tpl.social.storyEventDay"), { font: FONTS.bebas, size: 96, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1, shrink: true }),
      text(600, 716, 140, 40, t("studio.tpl.social.storyEventMonth"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 3, upper: true, shrink: true }),
      text(70, 830, 500, 34, t("studio.tpl.youAreInvited"), { font: FONTS.montserrat, size: 22, bold: true, color: rose, spacing: 6, upper: true, valign: "middle", shrink: true }),
      text(70, 878, 670, 270, t("studio.tpl.social.storyEventTitle"), { font: FONTS.abril, size: 92, color: ink, lineHeight: 1.0, shrink: true }),
      box("ellipse", 70, 1173, 16, 16, solid(rose)),
      text(100, 1162, 640, 38, t("studio.tpl.social.storyEventTime"), { font: FONTS.montserrat, size: 21, bold: true, color: ink, valign: "middle", shrink: true }),
      box("ellipse", 70, 1219, 16, 16, solid(rose)),
      text(100, 1208, 640, 38, t("studio.tpl.social.storyEventPlace"), { font: FONTS.montserrat, size: 20, color: "#5b21b6", valign: "middle", shrink: true }),
      ...pill(135, 1285, 540, 84, ink, t("studio.tpl.social.storyEventCta"), { font: FONTS.montserrat, size: 20, bold: true, color: "#ffffff" }),
      centredText(page, 1388, 28, t("studio.tpl.social.handle"), { font: FONTS.montserrat, size: 17, bold: true, color: "#6d28d9", valign: "middle", shrink: true }),
    ]),
  ]);
}

function flashSaleStory({ t }: TemplateContext) {
  const page = sizeOf(STORY);
  const ink = "#111827";
  const yellow = "#fde047";
  const pink = "#ec4899";
  const units = [
    ["studio.tpl.social.flashHours", "studio.tpl.social.hoursLabel"],
    ["studio.tpl.social.flashMinutes", "studio.tpl.social.minutesLabel"],
    ["studio.tpl.social.flashSeconds", "studio.tpl.social.secondsLabel"],
  ];
  return design(t("studio.templates.items.flashSaleStory"), [ink, pink, yellow], [
    pageOf(STORY, linear(180, "#fef9c3", "#fde047"), [
      box("ellipse", 470, -140, 520, 520, solid("#facc15"), { opacity: 0.6 }),
      box("ellipse", -200, 1180, 420, 420, solid("#facc15"), { opacity: 0.5 }),
      box("burst", 520, 80, 230, 230, solid(pink), { rotation: 10, points: 20, inner: 0.82 }),
      text(545, 150, 180, 90, t("studio.tpl.social.flashToday"), { font: FONTS.montserrat, size: 26, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, lineHeight: 1.1, rotation: 10, shrink: true }),
      text(60, 330, 690, 420, t("studio.tpl.social.flashTitle"), { font: FONTS.bebas, size: 250, color: ink, lineHeight: 0.82, valign: "middle", shrink: true }),
      box("rect", -80, 790, 970, 170, solid(ink), { rotation: -6 }),
      text(60, 805, 690, 140, t("studio.tpl.social.flashOffer"), { font: FONTS.bebas, size: 120, color: yellow, align: "center", valign: "middle", rotation: -6, shrink: true }),
      centredText(page, 1005, 34, t("studio.tpl.social.flashEndsIn"), { font: FONTS.montserrat, size: 18, bold: true, color: ink, spacing: 6, upper: true, valign: "middle", shrink: true }),
      ...units.flatMap(([value, label], index) => {
        const x = 120 + index * 200;
        return [
          box("rect", x, 1050, 170, 130, solid(ink), { radius: 20 }),
          text(x, 1058, 170, 82, t(value), { font: FONTS.bebas, size: 80, color: yellow, align: "center", valign: "middle", lineHeight: 1 }),
          text(x + 10, 1138, 150, 30, t(label), { font: FONTS.montserrat, size: 13, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 2, upper: true, shrink: true }),
        ];
      }),
      box("rect", 205, 1210, 400, 62, solid("#ffffff"), { radius: 14, stroke: stroke(ink, 2, "dashed") }),
      text(225, 1210, 360, 62, t("studio.tpl.social.flashCode"), { font: FONTS.montserrat, size: 20, bold: true, color: ink, align: "center", valign: "middle", spacing: 2, shrink: true }),
      ...pill(205, 1298, 400, 76, pink, t("studio.tpl.shopNow"), { font: FONTS.montserrat, size: 24, bold: true, color: "#ffffff", spacing: 3, upper: true }),
      centredText(page, 1392, 28, t("studio.tpl.website"), { font: FONTS.montserrat, size: 16, bold: true, color: ink, valign: "middle", shrink: true }),
    ]),
  ]);
}

function youtubeThumbnail({ t }: TemplateContext) {
  const yellow = "#facc15";
  const ink = "#0f172a";
  return design(t("studio.templates.items.youtubeThumbnail"), [yellow, ink], [
    pageOf(THUMBNAIL, linear(120, "#06b6d4", "#2563eb"), [
      box("ellipse", -160, 300, 420, 420, solid("#ffffff"), { opacity: 0.08 }),
      art("arcRings", { primary: "#ffffff", secondary: yellow }, 530, 30, 480, 480, { opacity: 0.45 }),
      box("ellipse", 565, 65, 410, 410, solid(yellow)),
      ...photoSlot(585, 85, 370, 370, "#fde68a", "circle"),
      ...pill(50, 46, 220, 46, ink, t("studio.tpl.social.thumbTag"), { font: FONTS.montserrat, size: 17, bold: true, color: yellow, spacing: 2, upper: true }),
      text(50, 112, 520, 136, t("studio.tpl.social.thumbTitle"), { font: FONTS.bebas, size: 72, color: "#ffffff", lineHeight: 0.92, valign: "bottom", shrink: true }),
      box("rect", 44, 262, 500, 126, solid(yellow), { radius: 10, rotation: -3 }),
      text(64, 266, 460, 118, t("studio.tpl.social.thumbHighlight"), { font: FONTS.bebas, size: 124, color: ink, align: "center", valign: "middle", lineHeight: 0.9, rotation: -3, shrink: true }),
      text(50, 416, 390, 76, t("studio.tpl.social.thumbLead"), { font: FONTS.montserrat, size: 24, bold: true, color: "#ffffff", lineHeight: 1.15, valign: "middle", shrink: true }),
      box("arrow", 452, 412, 128, 66, solid("#ffffff"), { rotation: -20 }),
    ]),
  ]);
}

function linkedinBanner({ t }: TemplateContext) {
  const navy = "#1e3a8a";
  const blue = "#2563eb";
  const sky = "#38bdf8";
  return design(t("studio.templates.items.linkedinBanner"), [blue, sky], [
    pageOf(BANNER, solid("#f8fafc"), [
      art("blob", { primary: "#dbeafe", secondary: "#e0f2fe" }, -90, -130, 320, 320),
      box("rect", 758, -60, 18, 420, solid(sky), { rotation: 18 }),
      box("rect", 820, -60, 520, 420, linear(135, blue, navy), { rotation: 18 }),
      art("arcRings", { primary: sky, secondary: "#ffffff" }, 1000, 40, 220, 220, { opacity: 0.5 }),
      text(330, 58, 420, 24, t("studio.tpl.social.bannerKicker"), { font: FONTS.montserrat, size: 13, bold: true, color: blue, spacing: 3, upper: true, valign: "middle", shrink: true }),
      text(330, 90, 400, 100, t("studio.tpl.social.bannerTitle"), { font: FONTS.poppins, size: 30, bold: true, color: "#0f172a", lineHeight: 1.15, valign: "middle", shrink: true }),
      box("rect", 330, 204, 60, 5, solid(sky), { radius: 2.5 }),
      text(330, 222, 200, 26, t("studio.tpl.website"), { font: FONTS.inter, size: 14, bold: true, color: "#334155", valign: "middle", shrink: true }),
      text(540, 222, 220, 26, t("studio.tpl.email"), { font: FONTS.inter, size: 14, color: "#334155", valign: "middle", shrink: true }),
      text(870, 100, 280, 96, t("studio.tpl.social.bannerCta"), { font: FONTS.dancing, size: 40, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
    ]),
  ]);
}

function pinterestPin({ t }: TemplateContext) {
  const page = PIN;
  const terracotta = "#c2410c";
  const ink = "#292524";
  const sand = "#e7d8c9";
  return design(t("studio.templates.items.pinterestPin"), [terracotta, ink], [
    pageOf(PIN, solid("#f5efe6"), [
      ...photoSlot(0, 0, page.width, 500, sand),
      box("rect", 60, 420, 630, 330, solid("#ffffff")),
      box("rect", 76, 436, 598, 298, { type: "none" }, { stroke: stroke(sand, 1.5) }),
      centredText(page, 462, 28, t("studio.tpl.social.pinKicker"), { font: FONTS.montserrat, size: 14, bold: true, color: terracotta, spacing: 5, upper: true, valign: "middle", shrink: true, inset: 110 }),
      centredText(page, 500, 164, t("studio.tpl.social.pinTitle"), { font: FONTS.playfair, size: 44, bold: true, color: ink, lineHeight: 1.12, valign: "middle", shrink: true, inset: 110 }),
      art("diamondDivider", { primary: terracotta, secondary: sand }, page.width / 2 - 100, 674, 200, 14),
      centredText(page, 698, 28, t("studio.tpl.social.pinLead"), { font: FONTS.lora, size: 17, italic: true, color: "#57534e", valign: "middle", shrink: true, inset: 110 }),
      ...photoSlot(60, 780, 305, 250, sand, "rounded"),
      ...photoSlot(385, 780, 305, 250, sand, "rounded"),
      centredText(page, 1052, 36, t("studio.tpl.website"), { font: FONTS.montserrat, size: 15, bold: true, color: ink, spacing: 2, valign: "middle", shrink: true }),
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
];
