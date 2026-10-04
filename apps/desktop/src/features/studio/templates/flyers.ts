import type { StudioElement } from "@/types/studio";
import { art, box, centredText, design, FONTS, linear, pageOf, photoSlot, qr, rule, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext, type TextOptions } from "./kit";

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

function pill(x: number, y: number, width: number, height: number, fill: string, value: string, options: TextOptions = {}): StudioElement[] {
  return [
    box("rect", x, y, width, height, solid(fill), { radius: height / 2 }),
    text(x + 6, y, width - 12, height, value, { font: FONTS.montserrat, size: 10, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1.5, shrink: true, ...options }),
  ];
}

function realEstateFlyer({ t }: TemplateContext) {
  const teal = "#0f3d3e";
  const gold = "#c8a35a";
  const thumb = (W - 72 - 24) / 3;
  const tile = (W - 72) / 4;
  const features = [
    ["bedsValue", "bedsLabel"],
    ["bathsValue", "bathsLabel"],
    ["areaValue", "areaLabel"],
    ["garageValue", "garageLabel"],
  ];
  return design(t("studio.templates.items.realEstateFlyer"), [teal, gold], [
    pageOf(A4, solid("#fbf8f3"), [
      ...photoSlot(0, 0, W, 400, "#d6d3cd"),
      ...pill(36, 36, 118, 30, gold, t(key("forSale")), { size: 11, spacing: 2 }),
      box("rect", 40, 338, W - 72, 132, solid(teal), { radius: 14, opacity: 0.12 }),
      box("rect", 36, 332, W - 72, 132, solid("#ffffff"), { radius: 14 }),
      text(60, 350, 300, 18, t(key("justListed")), { font: FONTS.montserrat, size: 10, bold: true, color: gold, upper: true, spacing: 2.5, shrink: true }),
      text(60, 370, 300, 56, t(key("homeTitle")), { font: FONTS.playfair, size: 24, bold: true, color: teal, lineHeight: 1.12, valign: "middle", shrink: true }),
      text(60, 430, 300, 20, t(key("homeAddress")), { font: FONTS.inter, size: 11, color: "#57534e", shrink: true }),
      vrule(380, 356, 84, "#e7e5e4", 1),
      text(396, 362, 140, 16, t(key("askingPrice")), { font: FONTS.inter, size: 9.5, color: "#78716c", align: "right", upper: true, spacing: 1.5, shrink: true }),
      text(396, 382, 140, 48, t(key("homePrice")), { font: FONTS.playfair, size: 30, bold: true, color: teal, align: "right", valign: "middle", shrink: true }),
      ...[0, 1, 2].flatMap((index) => photoSlot(36 + index * (thumb + 12), 484, thumb, 112, "#e7e5e4", "rounded")),
      ...features.flatMap(([value, label], index) => [
        text(36 + index * tile, 616, tile, 30, t(key(value)), { font: FONTS.playfair, size: 24, bold: true, color: teal, align: "center", valign: "middle", shrink: true }),
        text(36 + index * tile + 6, 648, tile - 12, 16, t(key(label)), { font: FONTS.inter, size: 9.5, color: "#78716c", align: "center", upper: true, spacing: 1, shrink: true }),
      ]),
      ...[1, 2, 3].map((index) => vrule(36 + index * tile, 620, 46, "#d6d3d1", 1)),
      text(36, 684, W - 72, 20, t(key("homeHighlights")), { font: FONTS.playfair, size: 11.5, italic: true, color: "#57534e", align: "center", shrink: true }),
      box("rect", 0, H - 128, W, 128, solid(teal)),
      ...photoSlot(36, H - 108, 88, 88, "#1d5c5d", "circle"),
      text(140, H - 106, 166, 20, t(key("agentName")), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", shrink: true }),
      text(140, H - 84, 166, 16, t(key("agentRole")), { font: FONTS.inter, size: 9.5, color: gold, shrink: true }),
      text(140, H - 62, 166, 18, t("studio.tpl.phone"), { font: FONTS.inter, size: 12, bold: true, color: "#ffffff", shrink: true }),
      text(140, H - 42, 166, 18, t("studio.tpl.email"), { font: FONTS.inter, size: 11, color: "#d6e4e4", shrink: true }),
      text(W - 286, H - 84, 134, 40, t(key("scanTour")), { font: FONTS.inter, size: 10, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      box("rect", W - 136, H - 112, 100, 100, solid("#ffffff"), { radius: 10 }),
      qr("https://example.com/listing", W - 128, H - 104, 84, teal),
    ]),
  ]);
}

function hiringFlyer({ t }: TemplateContext) {
  const indigo = "#4338ca";
  const deep = "#1e1b4b";
  const orange = "#f97316";
  const roles = [
    ["role1", "role1Meta"],
    ["role2", "role2Meta"],
    ["role3", "role3Meta"],
  ];
  const perks = ["perk1", "perk2", "perk3", "perk4"];
  const chip = (W - 80 - 30) / 4;
  return design(t("studio.templates.items.hiringFlyer"), [indigo, orange], [
    pageOf(A4, solid("#f8f7ff"), [
      box("ellipse", W - 260, -170, 440, 440, linear(135, "#818cf8", "#c084fc"), { opacity: 0.9 }),
      art("arcRings", { primary: "#ffffff", secondary: orange }, W - 230, -60, 260, 260, { opacity: 0.55 }),
      box("rect", 40, 44, 30, 30, solid(indigo), { radius: 8 }),
      box("diamond", 47, 51, 16, 16, solid("#ffffff")),
      text(80, 44, 220, 30, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 14, bold: true, color: deep, valign: "middle", shrink: true }),
      text(40, 112, 300, 30, t(key("joinTeam")), { font: FONTS.poppins, size: 16, bold: true, color: orange, upper: true, spacing: 3, valign: "middle", shrink: true }),
      text(40, 146, 350, 224, t(key("hiringTitle")), { font: FONTS.bebas, size: 120, color: deep, lineHeight: 0.88, valign: "bottom", shrink: true }),
      box("speech", W - 200, 250, 160, 104, solid(orange)),
      text(W - 190, 258, 140, 66, t(key("hiringBubble")), { font: FONTS.poppins, size: 20, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
      text(40, 384, W - 80, 44, t(key("hiringLead")), { font: FONTS.inter, size: 13.5, color: "#4b5563", lineHeight: 1.45, shrink: true }),
      ...roles.flatMap(([title, meta], index) => {
        const y = 446 + index * 74;
        return [
          box("rect", 40, y, W - 80, 62, solid("#ffffff"), { radius: 12, stroke: stroke("#e0e7ff", 1) }),
          box("rect", 52, y + 16, 4, 30, solid(orange), { radius: 2 }),
          text(68, y + 12, 320, 22, t(key(title)), { font: FONTS.poppins, size: 14, bold: true, color: deep, valign: "middle", shrink: true }),
          text(68, y + 34, 320, 16, t(key(meta)), { font: FONTS.inter, size: 10, color: "#6b7280", shrink: true }),
          ...pill(W - 152, y + 17, 96, 28, indigo, t(key("apply"))),
        ];
      }),
      text(40, 674, 300, 18, t(key("weOffer")), { font: FONTS.poppins, size: 12, bold: true, color: indigo, upper: true, spacing: 2, shrink: true }),
      ...perks.flatMap((perk, index) => [
        box("rect", 40 + index * (chip + 10), 698, chip, 30, solid("#eef2ff"), { radius: 15 }),
        text(46 + index * (chip + 10), 698, chip - 12, 30, t(key(perk)), { font: FONTS.inter, size: 10, bold: true, color: deep, align: "center", valign: "middle", shrink: true }),
      ]),
      box("rect", 0, H - 96, W, 96, solid(deep)),
      text(40, H - 80, 280, 18, t(key("sendCv")), { font: FONTS.inter, size: 11, color: "#c7d2fe", shrink: true }),
      text(40, H - 60, 280, 30, t("studio.tpl.email"), { font: FONTS.poppins, size: 20, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 30, 280, 16, t("studio.tpl.website"), { font: FONTS.inter, size: 10, color: "#a5b4fc", shrink: true }),
      text(W - 262, H - 66, 132, 36, t(key("scanApply")), { font: FONTS.inter, size: 10, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      box("rect", W - 120, H - 86, 76, 76, solid("#ffffff"), { radius: 8 }),
      qr("https://example.com/careers", W - 114, H - 80, 64, deep),
    ]),
  ]);
}

function lostPetFlyer({ t }: TemplateContext) {
  const red = "#dc2626";
  const ink = "#111827";
  const yellow = "#facc15";
  const strips = 9;
  const left = 40;
  const strip = (W - left * 2) / strips;
  const name = t(key("petName"));
  const phone = t("studio.tpl.phone");
  return design(t("studio.templates.items.lostPetFlyer"), [red, yellow], [
    pageOf(A4, solid("#fffdf7"), [
      box("rect", 0, 0, W, 128, solid(red)),
      centredText(PAGE, 14, 104, t(key("lostTitle")), { font: FONTS.bebas, size: 100, color: "#ffffff", valign: "middle", upper: true, spacing: 4, shrink: true, inset: 30 }),
      box("rect", 48, 146, W - 96, 296, solid(ink), { radius: 18 }),
      ...photoSlot(56, 154, W - 112, 280, "#e5e7eb", "rounded"),
      box("burst", W - 178, 104, 150, 150, solid(yellow), { points: 20, inner: 0.84, rotation: 12 }),
      text(W - 160, 144, 114, 70, t(key("seenMe")), { font: FONTS.caveat, size: 24, bold: true, color: ink, align: "center", valign: "middle", lineHeight: 1, rotation: 12, shrink: true }),
      centredText(PAGE, 452, 44, name, { font: FONTS.montserrat, size: 38, bold: true, color: ink, valign: "middle", upper: true, spacing: 6, shrink: true }),
      text(48, 508, 300, 88, t(key("petDetails")), { font: FONTS.inter, size: 12, color: "#374151", lineHeight: 1.5, valign: "middle", shrink: true }),
      box("rect", W - 228, 508, 180, 88, solid(red), { radius: 14 }),
      text(W - 220, 518, 164, 18, t(key("reward")), { font: FONTS.montserrat, size: 12, bold: true, color: "#fee2e2", align: "center", upper: true, spacing: 3, shrink: true }),
      text(W - 220, 538, 164, 50, t(key("rewardAmount")), { font: FONTS.bebas, size: 48, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
      centredText(PAGE, 608, 20, t(key("pleaseCall")), { font: FONTS.inter, size: 13, bold: true, color: ink, shrink: true }),
      centredText(PAGE, 630, 40, phone, { font: FONTS.bebas, size: 40, color: red, valign: "middle", spacing: 2, shrink: true }),
      rule(24, H - 152, W - 48, "#9ca3af", 1, "dashed"),
      ...Array.from({ length: strips + 1 }, (_, index) => vrule(left + index * strip, H - 146, 132, "#9ca3af", 0.8, "dashed")),
      ...Array.from({ length: strips }, (_, index) => {
        const centre = left + strip * (index + 0.5);
        return text(centre - 62, H - 102, 124, 44, `${name}\n${phone}`, {
          runs: [{ text: `${name}\n`, bold: true }, { text: phone }],
          font: FONTS.montserrat,
          size: 10,
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
  const rose = "#be123c";
  const gold = "#d4a017";
  const wine = "#3f0d1a";
  const perks = ["openingPerk1", "openingPerk2", "openingPerk3"];
  const column = (W - 112) / 3;
  return design(t("studio.templates.items.grandOpeningFlyer"), [rose, gold], [
    pageOf(A4, linear(180, "#fff1f2", "#fffbeb"), [
      art("confetti", { primary: rose, secondary: gold }, 0, 0, W, 330, { opacity: 0.55 }),
      centredText(PAGE, 66, 44, t(key("openingKicker")), { font: FONTS.dancing, size: 30, color: rose, valign: "middle", shrink: true }),
      centredText(PAGE, 116, 190, t("studio.tpl.grandOpening"), { font: FONTS.abril, size: 80, color: wine, lineHeight: 0.98, valign: "middle", shrink: true, inset: 40 }),
      art("ribbonBanner", { primary: rose, secondary: gold }, W / 2 - 200, 318, 400, 94),
      text(W / 2 - 160, 328, 320, 62, t("studio.tpl.openingDate"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1, shrink: true }),
      ...photoSlot(56, 430, W - 112, 200, "#fecdd3", "rounded"),
      art("starSeal", { primary: gold, secondary: "#ffffff" }, W - 190, 380, 140, 140, { rotation: 10 }),
      text(W - 176, 420, 112, 60, t(key("openingOffer")), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.1, rotation: 10, shrink: true }),
      ...perks.flatMap((perk, index) => {
        const x = 56 + index * column;
        return [
          box("diamond", x + column / 2 - 7, 654, 14, 14, solid(index === 1 ? gold : rose)),
          text(x + 6, 676, column - 12, 36, t(key(perk)), { font: FONTS.montserrat, size: 11.5, bold: true, color: wine, align: "center", lineHeight: 1.25, shrink: true }),
        ];
      }),
      art("flourishDivider", { primary: gold, secondary: rose }, W / 2 - 110, 724, 220, 29),
      centredText(PAGE, 762, 20, t("studio.tpl.openingPlace"), { font: FONTS.montserrat, size: 13, bold: true, color: wine, shrink: true }),
      centredText(PAGE, 786, 18, t("studio.tpl.website"), { font: FONTS.inter, size: 11, color: rose, shrink: true }),
    ]),
  ]);
}

function courseFlyer({ t }: TemplateContext) {
  const blue = "#1d4ed8";
  const navy = "#172554";
  const yellow = "#facc15";
  const split = W * 0.47;
  const card = (W - 80 - 24) / 3;
  const column = (W - 80) / 2;
  const stats = [
    ["durationLabel", "courseDuration"],
    ["formatLabel", "courseFormat"],
    ["startLabel", "courseStart"],
  ];
  const modules = ["module1", "module2", "module3", "module4", "module5", "module6"];
  return design(t("studio.templates.items.courseFlyer"), [blue, yellow], [
    pageOf(A4, solid("#f8fafc"), [
      ...photoSlot(split, 0, W - split, 460, "#bfdbfe"),
      art("blob", { primary: yellow, secondary: "#fde68a" }, split - 40, 360, 130, 130, { opacity: 0.95 }),
      ...pill(40, 56, 150, 26, blue, t(key("enrolOpen"))),
      text(40, 98, 226, 200, t(key("courseTitle")), { font: FONTS.poppins, size: 34, bold: true, color: navy, lineHeight: 1.08, valign: "middle", shrink: true }),
      box("rect", 40, 312, 56, 5, solid(yellow), { radius: 2.5 }),
      text(40, 330, 196, 110, t(key("courseLead")), { font: FONTS.inter, size: 12, color: "#334155", lineHeight: 1.5, shrink: true }),
      ...stats.flatMap(([label, value], index) => {
        const x = 40 + index * (card + 12);
        return [
          box("rect", x, 500, card, 66, solid("#ffffff"), { radius: 12, stroke: stroke("#dbeafe", 1) }),
          text(x + 16, 512, card - 32, 14, t(key(label)), { font: FONTS.inter, size: 9, bold: true, color: "#64748b", upper: true, spacing: 1, shrink: true }),
          text(x + 16, 530, card - 32, 24, t(key(value)), { font: FONTS.poppins, size: 14, bold: true, color: blue, valign: "middle", shrink: true }),
        ];
      }),
      text(40, 588, 300, 22, t(key("learnHeading")), { font: FONTS.poppins, size: 15, bold: true, color: navy, shrink: true }),
      ...modules.flatMap((module, index) => {
        const x = 40 + (index % 2) * column;
        const y = 622 + Math.floor(index / 2) * 34;
        return [
          box("ellipse", x, y, 24, 24, solid(index % 2 ? yellow : blue)),
          text(x, y, 24, 24, String(index + 1), { font: FONTS.poppins, size: 10, bold: true, color: index % 2 ? navy : "#ffffff", align: "center", valign: "middle" }),
          text(x + 34, y - 2, column - 44, 28, t(key(module)), { font: FONTS.inter, size: 11.5, color: "#1e293b", valign: "middle", shrink: true }),
        ];
      }),
      box("rect", 0, H - 112, W, 112, solid(navy)),
      text(40, H - 96, 220, 16, t(key("courseFeeLabel")), { font: FONTS.inter, size: 10, bold: true, color: "#93c5fd", upper: true, spacing: 1.5, shrink: true }),
      text(40, H - 78, 220, 40, t(key("coursePrice")), { font: FONTS.poppins, size: 30, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 36, 250, 18, t(key("earlyBird")), { font: FONTS.inter, size: 10.5, bold: true, color: yellow, shrink: true }),
      text(W - 280, H - 74, 144, 36, t(key("scanEnrol")), { font: FONTS.inter, size: 10.5, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      box("rect", W - 124, H - 98, 84, 84, solid("#ffffff"), { radius: 8 }),
      qr("https://example.com/enrol", W - 118, H - 92, 72, navy),
    ]),
  ]);
}

function charityFlyer({ t }: TemplateContext) {
  const orange = "#ea580c";
  const brown = "#7c2d12";
  const peach = "#fed7aa";
  const paper = "#fff7ed";
  const column = (W - 80) / 3;
  const details = [
    ["whenLabel", "charityWhen", "star"],
    ["whereLabel", "charityWhere", "pentagon"],
    ["entryLabel", "charityEntry", "heart"],
  ] as const;
  return design(t("studio.templates.items.charityFlyer"), [orange, brown], [
    pageOf(A4, solid(paper), [
      ...photoSlot(0, 0, W, 380, "#fdba74"),
      box("ellipse", -120, 330, W + 240, 160, solid(paper)),
      box("heart", W / 2 - 36, 314, 72, 64, solid(orange)),
      centredText(PAGE, 398, 20, t(key("charityKicker")), { font: FONTS.montserrat, size: 12, bold: true, color: orange, upper: true, spacing: 3, shrink: true }),
      centredText(PAGE, 422, 86, t(key("charityTitle")), { font: FONTS.playfair, size: 54, bold: true, color: brown, lineHeight: 1.02, valign: "middle", shrink: true, inset: 50 }),
      centredText(PAGE, 512, 44, t(key("charityLead")), { font: FONTS.inter, size: 12.5, color: "#57534e", lineHeight: 1.45, shrink: true, inset: 70 }),
      text(70, 570, 220, 16, t(key("raisedLabel")), { font: FONTS.inter, size: 10, bold: true, color: brown, upper: true, spacing: 1.5, shrink: true }),
      text(W - 290, 570, 220, 16, t(key("raisedAmount")), { font: FONTS.inter, size: 10.5, bold: true, color: orange, align: "right", shrink: true }),
      box("rect", 70, 592, W - 140, 14, solid(peach), { radius: 7 }),
      box("rect", 70, 592, (W - 140) * 0.62, 14, linear(0, "#fb923c", orange), { radius: 7 }),
      ...details.flatMap(([label, value, shape], index) => {
        const x = 40 + index * column;
        const centre = x + column / 2;
        return [
          box("ellipse", centre - 18, 628, 36, 36, solid("#ffedd5")),
          box(shape, centre - 8, 638, 16, 16, solid(orange)),
          text(x + 8, 672, column - 16, 14, t(key(label)), { font: FONTS.inter, size: 9, bold: true, color: orange, align: "center", upper: true, spacing: 1.5, shrink: true }),
          text(x + 8, 688, column - 16, 34, t(key(value)), { font: FONTS.inter, size: 11.5, bold: true, color: brown, align: "center", lineHeight: 1.3, shrink: true }),
        ];
      }),
      box("rect", 40, H - 104, W - 80, 80, solid(brown), { radius: 16 }),
      text(64, H - 92, 400, 24, t(key("donateCta")), { font: FONTS.poppins, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(64, H - 64, 400, 18, t("studio.tpl.website"), { font: FONTS.inter, size: 11, color: peach, shrink: true }),
      text(64, H - 46, 400, 16, t("studio.tpl.orgName"), { font: FONTS.inter, size: 10, color: "#fdba74", shrink: true }),
      box("rect", W - 120, H - 96, 64, 64, solid("#ffffff"), { radius: 8 }),
      qr("https://example.com/donate", W - 114, H - 90, 52, brown),
    ]),
  ]);
}

function serviceFlyer({ t }: TemplateContext) {
  const aqua = "#06b6d4";
  const navy = "#0c4a6e";
  const yellow = "#fde047";
  const reasons = ["serviceWhy1", "serviceWhy2", "serviceWhy3", "serviceWhy4"];
  const prices = [1, 2, 3, 4, 5, 6];
  return design(t("studio.templates.items.serviceFlyer"), [aqua, navy], [
    pageOf(A4, solid("#ffffff"), [
      box("ellipse", W - 120, -40, 180, 180, solid("#cffafe")),
      box("ellipse", W - 360, -60, 110, 110, solid("#e0f2fe")),
      box("ellipse", -50, 360, 110, 110, solid("#ecfeff")),
      box("ellipse", 40, 40, 34, 34, solid(aqua)),
      box("star", 48, 48, 18, 18, solid("#ffffff"), { points: 4, inner: 0.35 }),
      text(84, 38, 230, 20, t(key("serviceBrand")), { font: FONTS.poppins, size: 15, bold: true, color: navy, shrink: true }),
      text(84, 58, 230, 16, t(key("serviceTagline")), { font: FONTS.inter, size: 9.5, color: "#64748b", shrink: true }),
      box("ellipse", W - 292, 78, 256, 256, NONE, { stroke: stroke(aqua, 2, "dashed") }),
      ...photoSlot(W - 280, 90, 232, 232, "#cffafe", "circle"),
      box("star", W - 300, 296, 30, 30, solid(aqua), { points: 4, inner: 0.3 }),
      box("star", W - 66, 64, 22, 22, solid(yellow), { points: 4, inner: 0.3 }),
      text(40, 110, 260, 160, t(key("serviceTitle")), { font: FONTS.poppins, size: 30, bold: true, color: navy, lineHeight: 1.12, valign: "middle", shrink: true }),
      box("burst", W - 170, 250, 120, 120, solid(yellow), { points: 18, inner: 0.82 }),
      text(W - 158, 282, 96, 56, t(key("serviceOffer")), { font: FONTS.poppins, size: 12, bold: true, color: navy, align: "center", valign: "middle", lineHeight: 1.1, rotation: -8, shrink: true }),
      ...reasons.flatMap((reason, index) => {
        const y = 288 + index * 26;
        return [
          box("ellipse", 40, y + 5, 12, 12, solid(aqua)),
          text(60, y, 250, 22, t(key(reason)), { font: FONTS.inter, size: 11.5, color: "#334155", valign: "middle", shrink: true }),
        ];
      }),
      box("rect", 40, 412, W - 80, 252, solid("#ecfeff"), { radius: 18 }),
      text(64, 428, 260, 26, t("studio.tpl.priceList"), { font: FONTS.poppins, size: 18, bold: true, color: navy, valign: "middle", shrink: true }),
      text(W - 264, 432, 200, 20, t(key("pricesNote")), { font: FONTS.inter, size: 9.5, color: "#64748b", align: "right", valign: "middle", shrink: true }),
      ...prices.flatMap((item, index) => {
        const y = 470 + index * 30;
        return [
          text(64, y, 300, 24, t(key(`serviceItem${item}`)), { font: FONTS.inter, size: 12, color: navy, valign: "middle", shrink: true }),
          text(W - 214, y, 150, 24, t(key(`servicePrice${item}`)), { font: FONTS.poppins, size: 12.5, bold: true, color: "#0891b2", align: "right", valign: "middle", shrink: true }),
          ...(index < prices.length - 1 ? [rule(64, y + 28, W - 128, "#a5f3fc", 0.8, "dotted")] : []),
        ];
      }),
      art("waves", { primary: aqua, secondary: navy }, 0, H - 150, W, 40, { opacity: 0.8 }),
      box("rect", 0, H - 120, W, 120, solid(navy)),
      text(40, H - 100, 300, 18, t(key("serviceCta")), { font: FONTS.inter, size: 11, bold: true, color: "#a5f3fc", upper: true, spacing: 1.5, shrink: true }),
      text(40, H - 78, 270, 40, t("studio.tpl.phone"), { font: FONTS.poppins, size: 28, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(40, H - 34, 270, 18, t("studio.tpl.website"), { font: FONTS.inter, size: 11, color: "#e0f2fe", shrink: true }),
      text(W - 270, H - 76, 136, 36, t(key("scanBook")), { font: FONTS.inter, size: 10, color: "#ffffff", align: "right", valign: "middle", lineHeight: 1.3, shrink: true }),
      box("rect", W - 124, H - 104, 84, 84, solid("#ffffff"), { radius: 10 }),
      qr("https://example.com/book", W - 118, H - 98, 72, navy),
    ]),
  ]);
}

function campaignFlyer({ t }: TemplateContext) {
  const { width } = sizeOf(A5);
  const ink = "#111827";
  const magenta = "#db2777";
  return design(t("studio.templates.items.campaignFlyer"), [magenta, ink], [
    pageOf(A5, linear(160, "#fef08a", "#facc15"), [
      art("confetti", { primary: magenta, secondary: ink }, 0, 0, width, 240, { opacity: 0.25 }),
      ...pill(28, 28, 140, 24, ink, t(key("campaignKicker")), { size: 9.5 }),
      text(28, 62, width - 56, 160, t(key("campaignTitle")), { font: FONTS.bebas, size: 96, color: ink, lineHeight: 0.86, valign: "middle", shrink: true }),
      ...photoSlot(28, 236, 210, 190, "#fde68a", "rounded"),
      box("ellipse", width - 208, 206, 192, 192, NONE, { stroke: stroke(magenta, 1.5, "dashed") }),
      box("ellipse", width - 200, 214, 176, 176, solid(magenta)),
      text(width - 172, 246, 120, 18, t(key("upTo")), { font: FONTS.montserrat, size: 11, bold: true, color: "#ffffff", align: "center", upper: true, spacing: 2, shrink: true }),
      text(width - 180, 262, 136, 84, t(key("campaignDiscount")), { font: FONTS.bebas, size: 60, color: "#ffffff", align: "center", valign: "middle", lineHeight: 0.9, rotation: -6, shrink: true }),
      text(250, 400, width - 278, 26, t(key("campaignWhere")), { font: FONTS.montserrat, size: 12, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
      text(28, 440, width - 56, 36, t(key("campaignLead")), { font: FONTS.inter, size: 11.5, color: "#1f2937", lineHeight: 1.4, shrink: true }),
      box("rect", 28, 486, width - 56, 62, solid("#ffffff"), { radius: 10, stroke: stroke(ink, 1.2, "dashed") }),
      text(44, 494, 170, 14, t(key("couponLabel")), { font: FONTS.inter, size: 9, bold: true, color: "#6b7280", upper: true, spacing: 1.5, shrink: true }),
      text(44, 508, 180, 32, t(key("couponCode")), { font: FONTS.bebas, size: 30, color: magenta, valign: "middle", spacing: 2, shrink: true }),
      vrule(236, 496, 42, "#d1d5db", 1),
      text(250, 494, width - 290, 46, t(key("campaignValid")), { font: FONTS.inter, size: 10, color: ink, valign: "middle", lineHeight: 1.35, shrink: true }),
      text(28, 560, width - 56, 18, t("studio.tpl.website"), { font: FONTS.montserrat, size: 11, bold: true, color: ink, align: "center", shrink: true }),
    ]),
  ]);
}

function programmeFlyer({ t }: TemplateContext) {
  const green = "#14532d";
  const amber = "#d97706";
  const cream = "#fbf7ee";
  const ink = "#1c1917";
  const slots = [1, 2, 3, 4, 5, 6, 7];
  return design(t("studio.templates.items.programmeFlyer"), [green, amber], [
    pageOf(A4, solid(cream), [
      box("rect", 0, 0, W, 238, linear(135, green, "#166534")),
      art("arcRings", { primary: "#86efac", secondary: amber }, W - 220, -60, 280, 280, { opacity: 0.45 }),
      text(40, 48, 300, 18, t(key("programmeKicker")), { font: FONTS.montserrat, size: 11, bold: true, color: "#fcd34d", upper: true, spacing: 4, shrink: true }),
      text(40, 72, W - 140, 100, t(key("programmeTitle")), { font: FONTS.playfair, size: 44, bold: true, color: "#ffffff", lineHeight: 1.05, valign: "middle", shrink: true }),
      text(40, 180, W - 120, 20, t(key("programmeDate")), { font: FONTS.inter, size: 13, color: "#dcfce7", shrink: true }),
      art("dotsDivider", { primary: amber, secondary: "#ffffff" }, 40, 210, 120, 8),
      vrule(126, 272, 380, "#d6d3d1", 2),
      ...slots.flatMap((slot, index) => {
        const y = 268 + index * 62;
        const headline = index === slots.length - 1;
        return [
          ...(headline ? [box("rect", 138, y - 8, W - 170, 54, solid("#fef3c7"), { radius: 10 })] : []),
          text(40, y, 72, 22, t(key(`slotTime${slot}`)), { font: FONTS.montserrat, size: 13, bold: true, color: amber, align: "right", valign: "middle", shrink: true }),
          box("ellipse", 120, y + 5, 12, 12, solid(headline ? amber : green), { stroke: stroke(cream, 2) }),
          text(150, y, W - 196, 22, t(key(`slot${slot}`)), { font: FONTS.montserrat, size: 13.5, bold: true, color: ink, valign: "middle", shrink: true }),
          text(150, y + 22, W - 196, 18, t(key(`slotPlace${slot}`)), { font: FONTS.inter, size: 10.5, color: "#78716c", shrink: true }),
        ];
      }),
      box("rect", 40, 716, W - 80, 92, solid("#ffffff"), { radius: 16, stroke: stroke("#e7e5e4", 1) }),
      text(62, 730, 360, 24, t(key("programmeNote")), { font: FONTS.montserrat, size: 12.5, bold: true, color: green, valign: "middle", shrink: true }),
      text(62, 758, 360, 18, t("studio.tpl.address"), { font: FONTS.inter, size: 11, color: "#57534e", shrink: true }),
      text(62, 778, 360, 18, t("studio.tpl.website"), { font: FONTS.inter, size: 11, bold: true, color: amber, shrink: true }),
      qr("https://example.com/programme", W - 124, 728, 68, green),
      box("rect", 0, H - 14, W, 14, solid(green)),
    ]),
  ]);
}

function triFoldBrochure({ t }: TemplateContext) {
  const { width, height } = sizeOf(LANDSCAPE);
  const panel = width / 3;
  const m = 24;
  const inner = panel - m * 2;
  const blue = "#0369a1";
  const deep = "#0c2d48";
  const coral = "#ff7a59";
  const tint = "#f0f9ff";
  const kicker = (x: number, y: number, name: string) => text(x, y, inner, 18, t(key(name)), { font: FONTS.montserrat, size: 10, bold: true, color: coral, upper: true, spacing: 3, valign: "middle", shrink: true });
  const heading = (x: number, y: number, name: string, size = 20) => text(x, y, inner, 52, t(key(name)), { font: FONTS.playfair, size, bold: true, color: deep, lineHeight: 1.15, valign: "middle", shrink: true });
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
    ...reasons.flatMap((reason, index) => {
      const y = 128 + index * 70;
      return [
        box("ellipse", flap + m, y, 30, 30, solid(index % 2 ? coral : blue)),
        text(flap + m, y, 30, 30, String(reason), { font: FONTS.montserrat, size: 12, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
        text(flap + m + 42, y - 2, inner - 42, 20, t(key(`reason${reason}`)), { font: FONTS.montserrat, size: 12, bold: true, color: deep, valign: "middle", shrink: true }),
        text(flap + m + 42, y + 18, inner - 42, 40, t(key(`reasonBody${reason}`)), { font: FONTS.inter, size: 9.5, color: "#475569", lineHeight: 1.4, shrink: true }),
      ];
    }),
    box("rect", flap + m, 420, inner, 140, solid("#fff4ef"), { radius: 14 }),
    box("rect", flap + m + 18, 440, 32, 4, solid(coral), { radius: 2 }),
    text(flap + m + 18, 458, inner - 36, 64, t(key("testimonial")), { font: FONTS.playfair, size: 12, italic: true, color: deep, lineHeight: 1.45, valign: "middle", shrink: true }),
    text(flap + m + 18, 528, inner - 36, 18, t(key("testimonialAuthor")), { font: FONTS.inter, size: 9.5, bold: true, color: coral, shrink: true }),
    box("rect", back, 0, panel, height, solid(tint)),
    kicker(back + m, 34, "contactHeading"),
    heading(back + m, 56, "contactTitle"),
    ...contacts.flatMap((contact, index) => {
      const y = 132 + index * 40;
      return [
        box("ellipse", back + m, y, 26, 26, solid(blue)),
        box("diamond", back + m + 8, y + 8, 10, 10, solid("#ffffff")),
        text(back + m + 38, y - 2, inner - 38, 30, t(contact), { font: FONTS.inter, size: 11, color: deep, valign: "middle", lineHeight: 1.25, shrink: true }),
      ];
    }),
    ...photoSlot(back + m, 300, inner, 150, "#bae6fd", "rounded"),
    box("rect", back + m, 472, 84, 84, solid("#ffffff"), { radius: 10 }),
    qr("https://example.com/tours", back + m + 6, 478, 72, deep),
    text(back + m + 98, 478, inner - 98, 72, t(key("scanTours")), { font: FONTS.inter, size: 10.5, color: deep, valign: "middle", lineHeight: 1.35, shrink: true }),
    ...photoSlot(cover, 0, panel, 400, "#bae6fd"),
    box("ellipse", cover, 352, panel, 120, solid(deep)),
    box("rect", cover, 412, panel, height - 412, solid(deep)),
    box("rect", cover + m, 24, 200, 26, solid("#ffffff"), { radius: 13, opacity: 0.92 }),
    text(cover + m + 10, 24, 180, 26, t(key("travelBrand")), { font: FONTS.montserrat, size: 10, bold: true, color: deep, align: "center", valign: "middle", upper: true, spacing: 1.2, shrink: true }),
    text(cover + m, 404, inner, 20, t(key("brochureKicker")), { font: FONTS.montserrat, size: 10, bold: true, color: coral, align: "center", upper: true, spacing: 3, valign: "middle", shrink: true }),
    text(cover + m, 428, inner, 96, t(key("brochureTitle")), { font: FONTS.playfair, size: 30, bold: true, color: "#ffffff", align: "center", lineHeight: 1.08, valign: "middle", shrink: true }),
    text(cover + m, 530, inner, 38, t(key("brochureSubtitle")), { font: FONTS.inter, size: 10.5, color: "#bae6fd", align: "center", lineHeight: 1.4, shrink: true }),
  ]);
  const one = 0;
  const two = panel;
  const three = panel * 2;
  const inside = pageOf(LANDSCAPE, solid("#ffffff"), [
    ...photoSlot(one, 0, panel, 230, "#bae6fd"),
    kicker(one + m, 248, "aboutHeading"),
    heading(one + m, 270, "aboutTitle"),
    text(one + m, 330, inner, 150, t(key("aboutBody")), { font: FONTS.inter, size: 10, color: "#475569", lineHeight: 1.55, shrink: true }),
    rule(one + m, 494, inner, "#e2e8f0", 1),
    ...[
      ["statTravellers", "statTravellersLabel"],
      ["statDestinations", "statDestinationsLabel"],
    ].flatMap(([value, label], index) => {
      const x = one + m + index * (inner / 2);
      return [
        text(x, 506, inner / 2 - 8, 30, t(key(value)), { font: FONTS.playfair, size: 24, bold: true, color: blue, valign: "middle", shrink: true }),
        text(x, 538, inner / 2 - 8, 28, t(key(label)), { font: FONTS.inter, size: 9, color: "#64748b", lineHeight: 1.3, shrink: true }),
      ];
    }),
    box("rect", two, 0, panel, height, solid(tint)),
    kicker(two + m, 30, "toursHeading"),
    text(two + m, 52, inner, 36, t(key("toursTitle")), { font: FONTS.playfair, size: 20, bold: true, color: deep, valign: "middle", shrink: true }),
    ...tours.flatMap((tour, index) => {
      const y = 104 + index * 158;
      return [
        ...photoSlot(two + m, y, inner, 84, "#bae6fd", "rounded"),
        text(two + m, y + 92, inner - 104, 22, t(key(`tour${tour}`)), { font: FONTS.montserrat, size: 12, bold: true, color: deep, valign: "middle", shrink: true }),
        text(two + m, y + 114, inner - 104, 32, t(key(`tourMeta${tour}`)), { font: FONTS.inter, size: 9.5, color: "#64748b", lineHeight: 1.35, shrink: true }),
        ...pill(two + panel - m - 96, y + 96, 96, 26, coral, t(key(`tourPrice${tour}`)), { font: FONTS.montserrat, size: 10, upper: false, spacing: 0 }),
      ];
    }),
    kicker(three + m, 34, "includedHeading"),
    heading(three + m, 56, "includedTitle"),
    ...included.flatMap((item, index) => {
      const y = 124 + index * 32;
      return [
        box("ellipse", three + m, y + 5, 14, 14, solid("#e0f2fe")),
        box("ellipse", three + m + 4, y + 9, 6, 6, solid(blue)),
        text(three + m + 24, y, inner - 24, 24, t(key(`included${item}`)), { font: FONTS.inter, size: 11, color: deep, valign: "middle", shrink: true }),
      ];
    }),
    box("rect", three + m, 336, inner, 224, linear(160, blue, deep), { radius: 16 }),
    text(three + m + 20, 354, inner - 40, 18, t(key("bookHeading")), { font: FONTS.montserrat, size: 10, bold: true, color: "#fdba74", upper: true, spacing: 3, valign: "middle", shrink: true }),
    text(three + m + 20, 376, inner - 40, 60, t(key("bookTitle")), { font: FONTS.playfair, size: 18, bold: true, color: "#ffffff", lineHeight: 1.2, valign: "middle", shrink: true }),
    text(three + m + 20, 442, inner - 40, 20, t("studio.tpl.phone"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
    text(three + m + 20, 464, inner - 40, 18, t("studio.tpl.email"), { font: FONTS.inter, size: 10.5, color: "#bae6fd", valign: "middle", shrink: true }),
    box("rect", three + m + 20, 488, 60, 60, solid("#ffffff"), { radius: 8 }),
    qr("https://example.com/book", three + m + 24, 492, 52, deep),
    text(three + m + 92, 492, inner - 112, 52, t(key("scanBook")), { font: FONTS.inter, size: 10, color: "#ffffff", valign: "middle", lineHeight: 1.3, shrink: true }),
  ]);
  return design(t("studio.templates.items.triFoldBrochure"), [blue, coral], [outside, inside]);
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
];
