import { art, box, centredText, design, FONTS, linear, pageOf, photoSlot, qr, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext } from "./kit";

const A4 = "a4" as const;
const SQUARE = "square" as const;
const page = sizeOf(A4);
const W = page.width;
const H = page.height;

function eventPoster({ t }: TemplateContext) {
  const coral = "#f97316";
  const ink = "#111827";
  return design(t("studio.templates.items.eventPoster"), [coral, ink], [
    pageOf(A4, solid("#fff7ed"), [
      art("blob", { primary: coral, secondary: "#fb7185" }, W - 340, -120, 460, 460, { opacity: 0.9 }),
      art("dotsDivider", { primary: coral, secondary: ink }, 48, H - 60, 160, 12),
      text(48, 70, 300, 22, t("studio.tpl.orgName"), { font: FONTS.montserrat, size: 12, bold: true, color: ink, spacing: 3, upper: true, shrink: true }),
      text(48, 250, W - 96, 230, t("studio.tpl.eventTitle"), { font: FONTS.bebas, size: 118, color: ink, lineHeight: 0.9, shrink: true, valign: "bottom" }),
      box("rect", 48, 500, 120, 8, solid(coral)),
      text(48, 530, W - 140, 70, t("studio.tpl.eventLead"), { font: FONTS.inter, size: 16, color: "#374151", lineHeight: 1.45, shrink: true }),
      text(48, 640, 260, 26, t("studio.tpl.eventDate"), { font: FONTS.montserrat, size: 18, bold: true, color: coral, shrink: true }),
      text(48, 670, 260, 44, t("studio.tpl.eventPlace"), { font: FONTS.inter, size: 13, color: ink, lineHeight: 1.35, shrink: true }),
      qr("https://example.com/event", W - 150, H - 190, 100, ink),
      text(W - 230, H - 82, 180, 18, t("studio.tpl.scanForTickets"), { font: FONTS.inter, size: 10, color: "#4b5563", align: "right", shrink: true }),
    ]),
  ]);
}

function salePost({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const red = "#dc2626";
  const yellow = "#facc15";
  return design(t("studio.templates.items.salePost"), [red, yellow], [
    pageOf(SQUARE, solid(red), [
      art("confetti", { primary: yellow, secondary: "#ffffff" }, 0, 0, page.width, page.height, { opacity: 0.45 }),
      art("starSeal", { primary: yellow, secondary: red }, page.width - 300, 60, 240, 240, { rotation: 12 }),
      text(page.width - 260, 130, 160, 100, t("studio.tpl.discount"), { font: FONTS.abril, size: 48, color: red, align: "center", valign: "middle", rotation: 12, shrink: true }),
      text(70, 300, page.width - 140, 260, t("studio.tpl.bigSale"), { font: FONTS.bebas, size: 210, color: "#ffffff", lineHeight: 0.85, shrink: true, valign: "middle" }),
      text(70, 570, page.width - 140, 40, t("studio.tpl.saleLead"), { font: FONTS.montserrat, size: 26, bold: true, color: yellow, upper: true, spacing: 2, shrink: true }),
      box("rect", 70, 650, 330, 66, solid("#ffffff"), { radius: 33 }),
      text(70, 650, 330, 66, t("studio.tpl.shopNow"), { font: FONTS.montserrat, size: 24, bold: true, color: red, align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(430, 660, page.width - 500, 46, t("studio.tpl.website"), { font: FONTS.montserrat, size: 20, color: "#ffffff", valign: "middle", shrink: true }),
    ]),
  ]);
}

function concert({ t }: TemplateContext) {
  const magenta = "#e11d48";
  const cyan = "#06b6d4";
  return design(t("studio.templates.items.concert"), [magenta, cyan], [
    pageOf(A4, linear(180, "#0f0a1e", "#2e1065"), [
      art("waves", { primary: magenta, secondary: cyan }, 0, H - 160, W, 160, { opacity: 0.9 }),
      art("arcRings", { primary: cyan, secondary: magenta }, W / 2 - 190, 90, 380, 380, { opacity: 0.6 }),
      ...photoSlot(W / 2 - 130, 150, 260, 260, "#3b1d6e", "circle"),
      centredText(page, 450, 30, t("studio.tpl.liveInConcert"), { font: FONTS.montserrat, size: 16, bold: true, color: cyan, spacing: 8, upper: true, shrink: true }),
      centredText(page, 486, 120, t("studio.tpl.bandName"), { font: FONTS.bebas, size: 96, color: "#ffffff", lineHeight: 0.9, shrink: true, valign: "middle" }),
      centredText(page, 616, 28, t("studio.tpl.concertDate"), { font: FONTS.montserrat, size: 18, bold: true, color: "#ffffff", spacing: 2, upper: true, shrink: true }),
      centredText(page, 648, 24, t("studio.tpl.concertPlace"), { font: FONTS.montserrat, size: 14, color: "#e5e7eb", shrink: true }),
      centredText(page, H - 80, 24, t("studio.tpl.ticketsAt"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", spacing: 2, upper: true, shrink: true }),
    ]),
  ]);
}

function workshop({ t }: TemplateContext) {
  const green = "#15803d";
  const cream = "#fefce8";
  const items = ["studio.tpl.workshopPoint1", "studio.tpl.workshopPoint2", "studio.tpl.workshopPoint3"];
  return design(t("studio.templates.items.workshop"), [green, "#ca8a04"], [
    pageOf(A4, solid(cream), [
      box("rect", 0, 0, W, 330, solid(green)),
      art("blob", { primary: "#22c55e", secondary: "#86efac" }, W - 260, -80, 340, 320, { opacity: 0.5 }),
      text(48, 60, 300, 22, t("studio.tpl.freeWorkshop"), { font: FONTS.poppins, size: 12, bold: true, color: "#bbf7d0", spacing: 3, upper: true, shrink: true }),
      text(48, 96, W - 140, 200, t("studio.tpl.workshopTitle"), { font: FONTS.poppins, size: 46, bold: true, color: "#ffffff", lineHeight: 1.08, shrink: true, valign: "middle" }),
      text(48, 370, W - 96, 60, t("studio.tpl.workshopLead"), { font: FONTS.poppins, size: 15, color: "#374151", lineHeight: 1.5, shrink: true }),
      ...items.flatMap((key, index) => [
        box("ellipse", 48, 458 + index * 54, 30, 30, solid(green)),
        text(48, 458 + index * 54, 30, 30, String(index + 1), { font: FONTS.poppins, size: 14, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
        text(92, 456 + index * 54, W - 140, 34, t(key), { font: FONTS.poppins, size: 15, color: "#1f2937", valign: "middle", shrink: true }),
      ]),
      rule(48, 650, W - 96, "#d9f99d", 2),
      text(48, 672, 300, 26, t("studio.tpl.workshopDate"), { font: FONTS.poppins, size: 17, bold: true, color: green, shrink: true }),
      text(48, 702, 300, 44, t("studio.tpl.workshopPlace"), { font: FONTS.poppins, size: 13, color: "#374151", lineHeight: 1.35, shrink: true }),
      qr("https://example.com/register", W - 148, 660, 100, green),
      text(W - 248, 768, 200, 18, t("studio.tpl.registerNow"), { font: FONTS.poppins, size: 11, bold: true, color: green, align: "right", shrink: true }),
    ]),
  ]);
}

function announcement({ t }: TemplateContext) {
  const navy = "#1e3a8a";
  const sky = "#38bdf8";
  return design(t("studio.templates.items.announcement"), [navy, sky], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, 16, solid(navy)),
      box("rect", 0, H - 16, W, 16, solid(navy)),
      art("cornerTriangles", { primary: navy, secondary: sky }, W - 180, 16, 180, 180, { rotation: 90 }),
      text(56, 90, W - 260, 22, t("studio.tpl.orgName"), { font: FONTS.sourceSerif, size: 13, bold: true, color: navy, spacing: 2, upper: true, shrink: true }),
      text(56, 160, W - 112, 90, t("studio.tpl.announcementTitle"), { font: FONTS.merriweather, size: 48, bold: true, color: "#0f172a", lineHeight: 1.1, shrink: true }),
      box("rect", 56, 266, 80, 6, solid(sky)),
      text(56, 300, W - 112, 330, t("studio.tpl.announcementBody"), { font: FONTS.sourceSerif, size: 15, color: "#1f2937", lineHeight: 1.6, shrink: true }),
      box("rect", 56, 660, W - 112, 90, solid("#eff6ff"), { radius: 10 }),
      text(76, 674, W - 152, 62, t("studio.tpl.announcementNote"), { font: FONTS.sourceSerif, size: 13, italic: true, color: navy, lineHeight: 1.45, valign: "middle", shrink: true }),
      text(56, 770, W - 112, 20, t("studio.tpl.management"), { font: FONTS.sourceSerif, size: 12, bold: true, color: "#374151", align: "right", shrink: true }),
    ]),
  ]);
}

function comingSoon({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const ink = "#0b0b0f";
  const gold = "#eab308";
  return design(t("studio.templates.items.comingSoon"), [ink, gold], [
    pageOf(SQUARE, solid(ink), [
      art("arcRings", { primary: gold, secondary: "#a16207" }, page.width / 2 - 330, page.height / 2 - 330, 660, 660, { opacity: 0.35 }),
      centredText(page, 230, 30, t("studio.tpl.companyName"), { font: FONTS.josefin, size: 20, color: gold, spacing: 10, upper: true, shrink: true }),
      centredText(page, 290, 220, t("studio.tpl.comingSoon"), { font: FONTS.josefin, size: 118, bold: true, color: "#ffffff", lineHeight: 0.95, upper: true, shrink: true, valign: "middle" }),
      rule(page.width / 2 - 60, 540, 120, gold, 3),
      centredText(page, 566, 60, t("studio.tpl.comingSoonLead"), { font: FONTS.josefin, size: 24, color: "#d4d4d8", lineHeight: 1.35, shrink: true }),
      centredText(page, 700, 30, t("studio.tpl.website"), { font: FONTS.josefin, size: 20, color: gold, spacing: 3, shrink: true }),
    ]),
  ]);
}

function conference({ t }: TemplateContext) {
  const violet = "#5b21b6";
  const pink = "#db2777";
  const speakers = [0, 1, 2];
  return design(t("studio.templates.items.conference"), [violet, pink], [
    pageOf(A4, linear(160, "#1e1b4b", violet), [
      art("blob", { primary: pink, secondary: violet }, W - 280, -60, 360, 360, { opacity: 0.6 }),
      art("dotsDivider", { primary: "#ffffff", secondary: pink }, 48, 56, 160, 12),
      text(48, 90, W - 96, 22, t("studio.tpl.conferenceYear"), { font: FONTS.montserrat, size: 13, bold: true, color: "#f9a8d4", spacing: 3, upper: true, shrink: true }),
      text(48, 120, W - 96, 170, t("studio.tpl.conferenceTitle"), { font: FONTS.montserrat, size: 56, bold: true, color: "#ffffff", lineHeight: 1.0, shrink: true, valign: "middle" }),
      text(48, 300, W - 140, 60, t("studio.tpl.conferenceLead"), { font: FONTS.inter, size: 15, color: "#ddd6fe", lineHeight: 1.45, shrink: true }),
      text(48, 392, W - 96, 22, t("studio.tpl.speakers"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", spacing: 3, upper: true }),
      ...speakers.flatMap((index) => {
        const x = 48 + index * 170;
        return [
          ...photoSlot(x, 426, 120, 120, "#4c1d95", "circle"),
          text(x - 10, 556, 140, 20, t("studio.tpl.speakerName"), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", align: "center", shrink: true }),
          text(x - 10, 576, 140, 18, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 10, color: "#c4b5fd", align: "center", shrink: true }),
        ];
      }),
      box("rect", 48, 640, W - 96, 120, solid("#ffffff"), { radius: 16, opacity: 0.08 }),
      text(72, 662, 300, 26, t("studio.tpl.conferenceDate"), { font: FONTS.montserrat, size: 17, bold: true, color: "#ffffff", shrink: true }),
      text(72, 694, 300, 44, t("studio.tpl.conferencePlace"), { font: FONTS.inter, size: 13, color: "#ddd6fe", lineHeight: 1.35, shrink: true }),
      qr("https://example.com/conference", W - 158, 652, 96, "#ffffff"),
    ]),
  ]);
}

function fitness({ t }: TemplateContext) {
  const lime = "#a3e635";
  const ink = "#0a0a0a";
  return design(t("studio.templates.items.fitness"), [lime, ink], [
    pageOf(A4, solid(ink), [
      ...photoSlot(0, 0, W, 470, "#262626"),
      box("rect", 0, 470, W, H - 470, solid(ink)),
      box("parallelogram", 36, 440, 260, 56, solid(lime)),
      text(56, 440, 220, 56, t("studio.tpl.joinToday"), { font: FONTS.oswald, size: 22, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 2, shrink: true }),
      text(40, 520, W - 80, 160, t("studio.tpl.fitnessTitle"), { font: FONTS.oswald, size: 72, bold: true, color: "#ffffff", lineHeight: 0.95, upper: true, shrink: true, valign: "middle" }),
      text(40, 690, W - 80, 50, t("studio.tpl.fitnessLead"), { font: FONTS.inter, size: 15, color: "#d4d4d4", lineHeight: 1.45, shrink: true }),
      rule(40, 760, W - 80, lime, 2),
      text(40, 774, W / 2 - 40, 30, t("studio.tpl.phone"), { font: FONTS.oswald, size: 16, color: lime, valign: "middle", shrink: true }),
      text(W / 2, 774, W / 2 - 40, 30, t("studio.tpl.website"), { font: FONTS.oswald, size: 16, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
    ]),
  ]);
}

export const POSTER_TEMPLATES: StudioTemplate[] = [
  { id: "eventPoster", category: "posters", size: A4, build: eventPoster },
  { id: "salePost", category: "posters", size: SQUARE, build: salePost },
  { id: "concert", category: "posters", size: A4, build: concert },
  { id: "workshop", category: "posters", size: A4, build: workshop },
  { id: "announcement", category: "posters", size: A4, build: announcement },
  { id: "comingSoon", category: "posters", size: SQUARE, build: comingSoon },
  { id: "conference", category: "posters", size: A4, build: conference },
  { id: "fitness", category: "posters", size: A4, build: fitness },
];
