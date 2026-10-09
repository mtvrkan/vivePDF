import type { StudioElement, StudioPage } from "@/types/studio";
import { withCorner } from "../model/cards";
import { buildVCard, EMPTY_VCARD } from "../model/vcard";
import { art, box, centredText, design, finished, FONTS, gilded, glossed, gradient, initials, pageOf, qr, radial, sizeOf, solid, stroke, text, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const EU = "businessCardEu" as const;
const US = "businessCard" as const;
const WIDE = "businessCardWide" as const;
const SQUARE = "businessCardSquare" as const;
const MINI = "businessCardMini" as const;
const VERTICAL: TemplateSize = { width: 155.91, height: 240.94 };
const CONTACT_KEYS = ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website", "studio.tpl.address"];
const NONE = { type: "none" } as const;

type Translate = TemplateContext["t"];
type Marker = (x: number, y: number) => StudioElement;
type ContactStyle = { font: string; color: string; size?: number; gap?: number; rows?: string[]; marker?: Marker };

const embossed = <T extends StudioElement>(element: T) => finished(element, "emboss");
const debossed = <T extends StudioElement>(element: T) => finished(element, "deboss");
const pressed = <T extends StudioElement>(element: T) => finished(element, "letterpress");

function sides(t: Translate, front: StudioPage, back: StudioPage): StudioPage[] {
  return [
    { ...front, name: t("studio.page.front") },
    { ...back, name: t("studio.page.back") },
  ];
}

function contacts(t: Translate, x: number, y: number, width: number, style: ContactStyle): StudioElement[] {
  const gap = style.gap ?? 14;
  const indent = style.marker ? 10 : 0;
  return (style.rows ?? CONTACT_KEYS).flatMap((key, index) => {
    const top = y + index * gap;
    const line = text(x + indent, top, width - indent, 12, t(key), { font: style.font, size: style.size ?? 7, color: style.color, valign: "middle", shrink: true });
    return style.marker ? [style.marker(x, top + 4), line] : [line];
  });
}

function ivoryEmboss({ t }: TemplateContext) {
  const { width: w, height: h } = sizeOf(EU);
  const paper = radial("#fbf7ee", "#efe6d3", { cy: 0.4, radius: 1.1 });
  const relief = "#e9dfca";
  const ink = "#2b251c";
  const bronze = "#7a5c2e";
  return design(t("studio.templates.items.ivoryEmbossCard"), [ink, bronze, relief, "#fbf7ee"], sides(t,
    pageOf(EU, paper, [
      embossed(box("ellipse", w / 2 - 34, 20, 68, 68, NONE, { stroke: stroke(relief, 1.6) })),
      embossed(box("ellipse", w / 2 - 29, 25, 58, 58, NONE, { stroke: stroke(relief, 0.6) })),
      finished(text(w / 2 - 29, 25, 58, 58, initials(t("studio.tpl.personName")), { font: FONTS.cormorant, size: 30, bold: true, color: relief, align: "center", valign: "middle", lineHeight: 1 }), "emboss", { depth: 1.4 }),
      centredText({ width: w }, 100, 18, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 12, bold: true, color: "#3a3326", spacing: 2.5, upper: true, valign: "middle", shrink: true, inset: 20 }),
      centredText({ width: w }, 120, 12, t("studio.tpl.companyTagline"), { font: FONTS.montserrat, size: 6, color: "#6b5f4b", spacing: 1.6, upper: true, valign: "middle", shrink: true, inset: 26 }),
    ]),
    pageOf(EU, paper, [
      embossed(box("rect", 10, 10, w - 20, h - 20, NONE, { stroke: stroke(relief, 1.2) })),
      text(22, 24, w - 44, 22, t("studio.tpl.personName"), { font: FONTS.cormorant, size: 16, bold: true, color: ink, valign: "middle", shrink: true }),
      text(22, 46, w - 44, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 6.5, bold: true, color: bronze, spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      embossed(box("rect", 22, 64, 30, 1.6, solid(relief))),
      ...contacts(t, 22, 74, w - 44, { font: FONTS.montserrat, color: "#3a3326", marker: (x, y) => embossed(box("diamond", x, y, 4, 4, solid(relief))) }),
    ]),
  ));
}

function goldFoilNoir({ t }: TemplateContext) {
  const page = sizeOf(US);
  const { width: w, height: h } = page;
  const gold = "#d4af5a";
  const pale = "#f6e3a1";
  const onyx = "#0e0e11";
  const colours = { primary: gold, secondary: pale };
  return design(t("studio.templates.items.goldFoilNoirCard"), [onyx, gold, pale, "#e5e1d8"], sides(t,
    pageOf(US, radial("#1f1f24", "#0b0b0d", { cy: 0.42, radius: 1.05 }), [
      art("marble", { primary: "#2a2a30", secondary: "#3a3326" }, 0, 0, w, h, { opacity: 0.45 }),
      gilded(box("diamond", w / 2 - 17, 18, 34, 34, NONE, { stroke: stroke(gold, 0.8) })),
      gilded(text(w / 2 - 17, 18, 34, 34, initials(t("studio.tpl.personName")), { font: FONTS.cinzel, size: 11, bold: true, color: gold, align: "center", valign: "middle", lineHeight: 1 })),
      gilded(centredText(page, 56, 28, t("studio.tpl.companyName"), { font: FONTS.cinzel, size: 15, bold: true, color: gold, spacing: 2.5, upper: true, valign: "middle", shrink: true, inset: 22 })),
      gilded(box("rect", w / 2 - 22, 90, 44, 1.2, solid(gold))),
      centredText(page, 98, 14, t("studio.tpl.companyTagline"), { font: FONTS.montserrat, size: 6.5, bold: true, color: "#cfc6b0", spacing: 2, upper: true, valign: "middle", shrink: true, inset: 28 }),
    ]),
    pageOf(US, solid(onyx), [
      gilded(box("rect", 10, 10, w - 20, h - 20, NONE, { stroke: stroke(gold, 0.6) })),
      gilded(text(22, 20, 146, 22, t("studio.tpl.personName"), { font: FONTS.cinzel, size: 14, bold: true, color: gold, valign: "middle", shrink: true })),
      text(22, 43, 146, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 6.5, bold: true, color: "#bdb5a1", spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      gilded(box("rect", 22, 61, 28, 1.2, solid(gold))),
      ...contacts(t, 22, 70, 146, { font: FONTS.montserrat, color: "#e5e1d8", marker: (x, y) => gilded(box("diamond", x, y, 4, 4, solid(gold))) }),
      gilded(art("guillocheRosette", colours, w - 80, h / 2 - 30, 60, 60)),
    ]),
  ));
}

function letterpressCotton({ t }: TemplateContext) {
  const page = sizeOf(EU);
  const { width: w } = page;
  const cotton = radial("#faf8f3", "#f1ede4", { cy: 0.4, radius: 1.1 });
  const ink = "#1f2d45";
  const rust = "#9c4321";
  return design(t("studio.templates.items.letterpressCottonCard"), [ink, rust, "#faf8f3", "#5b6474"], sides(t,
    pageOf(EU, cotton, [
      pressed(art("flourishDivider", { primary: ink, secondary: rust }, w / 2 - 40, 26, 80, 14)),
      pressed(centredText(page, 46, 34, t("studio.tpl.personName"), { font: FONTS.playfair, size: 20, bold: true, color: ink, valign: "middle", shrink: true, inset: 20 })),
      pressed(box("rect", w / 2 - 14, 86, 28, 1.6, solid(rust))),
      pressed(centredText(page, 94, 12, t("studio.tpl.jobTitle"), { font: FONTS.raleway, size: 7, bold: true, color: rust, spacing: 2, upper: true, valign: "middle", shrink: true, inset: 24 })),
    ]),
    pageOf(EU, cotton, [
      pressed(text(20, 18, w - 40, 22, t("studio.tpl.companyName"), { font: FONTS.playfair, size: 13, bold: true, color: ink, valign: "middle", shrink: true })),
      text(20, 40, w - 40, 12, t("studio.tpl.companyTagline"), { font: FONTS.raleway, size: 6.5, color: "#5b6474", spacing: 1.2, valign: "middle", shrink: true }),
      pressed(box("rect", 20, 60, w - 40, 1, solid(ink))),
      ...contacts(t, 20, 70, w - 40, { font: FONTS.raleway, color: ink, marker: (x, y) => pressed(box("ellipse", x, y, 4, 4, solid(rust))) }).map((element) => (element.kind === "text" ? pressed(element) : element)),
    ]),
  ));
}

function spotUvCharcoal({ t }: TemplateContext) {
  const page = sizeOf(WIDE);
  const { width: w, height: h } = page;
  const charcoal = "#23262c";
  const steel = "#9fb7d6";
  return design(t("studio.templates.items.spotUvCharcoalCard"), [charcoal, steel, "#ffffff", "#d7dbe2"], sides(t,
    pageOf(WIDE, solid(charcoal), [
      glossed(art("topographic", { primary: "#30343c", secondary: "#2a2e35" }, 0, 0, w, h)),
      glossed(box("diamond", w / 2 - 14, 32, 28, 28, solid("#e8eaee"))),
      centredText(page, 70, 24, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 15, bold: true, color: "#ffffff", spacing: 1.5, upper: true, valign: "middle", shrink: true, inset: 24 }),
      centredText(page, 96, 12, t("studio.tpl.companyTagline"), { font: FONTS.inter, size: 6.5, color: "#aeb6c2", spacing: 1.6, upper: true, valign: "middle", shrink: true, inset: 30 }),
    ]),
    pageOf(WIDE, solid(charcoal), [
      glossed(art("diagonalHatch", { primary: "#2e323a", secondary: "#2e323a" }, w - 90, 0, 90, h)),
      glossed(box("diamond", w - 59, h / 2 - 14, 28, 28, solid("#e8eaee"))),
      text(22, 20, 150, 22, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(22, 43, 150, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 6.5, bold: true, color: steel, spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      box("rect", 22, 60, 26, 2, solid(steel)),
      ...contacts(t, 22, 70, 150, { font: FONTS.inter, color: "#d7dbe2", marker: (x, y) => box("ellipse", x, y, 4, 4, solid(steel)) }),
    ]),
  ));
}

function roseGoldPlum({ t }: TemplateContext) {
  const page = sizeOf(EU);
  const { width: w, height: h } = page;
  const rose = "#e2a99f";
  const blush = "#f6cfc6";
  const plum = "#3b1f2b";
  const colours = { primary: rose, secondary: blush };
  const card = design(t("studio.templates.items.roseGoldPlumCard"), [plum, rose, blush, "#fff8f6"], sides(t,
    pageOf(EU, radial("#4a2636", "#2c1520", { cy: 0.4, radius: 1.1 }), [
      gilded(art("botanicalSprig", colours, w / 2 - 30, 16, 60, 30), "roseGold"),
      gilded(centredText(page, 50, 42, t("studio.tpl.personName"), { font: FONTS.greatVibes, size: 28, color: rose, lineHeight: 1.2, valign: "middle", shrink: true, inset: 16 }), "roseGold"),
      centredText(page, 98, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 6.5, bold: true, color: "#f3dcd6", spacing: 2, upper: true, valign: "middle", shrink: true, inset: 24 }),
      gilded(box("rect", w / 2 - 18, 118, 36, 1, solid(rose)), "roseGold"),
    ]),
    pageOf(EU, radial("#fff8f6", "#f8e4e2", { cx: 0.3, cy: 0.35, radius: 1.1 }), [
      gilded(box("rect", 0, 0, w, 3, solid(rose)), "roseGold"),
      text(22, 20, 150, 22, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 15, bold: true, color: plum, valign: "middle", shrink: true }),
      text(22, 42, 150, 12, t("studio.tpl.companyTagline"), { font: FONTS.montserrat, size: 6.5, color: "#7d5d66", spacing: 1.2, valign: "middle", shrink: true }),
      gilded(box("rect", 22, 60, 28, 1.2, solid(rose)), "roseGold"),
      ...contacts(t, 22, 70, 140, { font: FONTS.montserrat, color: plum, marker: (x, y) => gilded(box("ellipse", x, y, 4, 4, solid(rose)), "roseGold") }),
      gilded(art("botanicalSprig", colours, w - 66, h - 58, 50, 44, { rotation: -20 }), "roseGold"),
    ]),
  ));
  return withCorner(card, 3);
}

function copperKraft({ t }: TemplateContext) {
  const page = sizeOf(US);
  const { width: w, height: h } = page;
  const kraft = gradient(135, ["#cfae84", "#c09a6c", "#cba67a"]);
  const copper = "#b8683a";
  const colours = { primary: copper, secondary: "#efb28a" };
  const ink = "#2b1d10";
  const grain = () => art("halftone", { primary: "#a88456", secondary: "#a88456" }, 0, 0, w, h, { opacity: 0.16 });
  return design(t("studio.templates.items.copperKraftCard"), [ink, copper, "#c7a376", "#4a3320"], sides(t,
    pageOf(US, kraft, [
      grain(),
      gilded(art("laurel", colours, w / 2 - 24, 16, 48, 40), "copper"),
      centredText(page, 60, 28, t("studio.tpl.companyName"), { font: FONTS.oswald, size: 17, bold: true, color: ink, spacing: 2, upper: true, valign: "middle", shrink: true, inset: 22 }),
      gilded(box("rect", w / 2 - 20, 94, 40, 1.4, solid(copper)), "copper"),
      centredText(page, 102, 14, t("studio.tpl.companyTagline"), { font: FONTS.lora, size: 7, italic: true, color: "#3d2a17", valign: "middle", shrink: true, inset: 28 }),
    ]),
    pageOf(US, kraft, [
      grain(),
      gilded(box("rect", 9, 9, w - 18, h - 18, NONE, { stroke: stroke(copper, 0.8) }), "copper"),
      text(22, 20, 146, 22, t("studio.tpl.personName"), { font: FONTS.oswald, size: 15, bold: true, color: ink, valign: "middle", shrink: true }),
      text(22, 42, 146, 14, t("studio.tpl.jobTitle"), { font: FONTS.lora, size: 7.5, italic: true, color: "#4a3320", valign: "middle", shrink: true }),
      gilded(box("rect", 22, 61, 28, 1.4, solid(copper)), "copper"),
      ...contacts(t, 22, 70, 146, { font: FONTS.lora, color: ink, marker: (x, y) => gilded(box("diamond", x, y, 4, 4, solid(copper)), "copper") }),
      gilded(art("guillocheRosette", colours, w - 80, h / 2 - 30, 60, 60), "copper"),
    ]),
  ));
}

function holographicSquare({ t }: TemplateContext) {
  const page = sizeOf(SQUARE);
  const { width: w } = page;
  const night = "#0d0c14";
  const violet = "#b18cff";
  const ink = "#14121f";
  const monogram = initials(t("studio.tpl.personName"));
  const card = design(t("studio.templates.items.holographicSquareCard"), [night, violet, "#6fe3ff", "#fff07a"], sides(t,
    pageOf(SQUARE, solid("#fbfbfd"), [
      gilded(art("blob", { primary: violet, secondary: "#6fe3ff" }, 24, 16, 136, 120), "holographic"),
      centredText(page, 50, 52, monogram, { font: FONTS.poppins, size: 36, bold: true, color: ink, lineHeight: 1, valign: "middle" }),
      centredText(page, 140, 22, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 14, bold: true, color: ink, valign: "middle", shrink: true, inset: 16 }),
      centredText(page, 162, 12, t("studio.tpl.website"), { font: FONTS.inter, size: 6.5, bold: true, color: "#4b4f63", spacing: 1.2, valign: "middle", shrink: true, inset: 20 }),
    ]),
    pageOf(SQUARE, solid(night), [
      gilded(centredText(page, 26, 36, monogram, { font: FONTS.poppins, size: 28, bold: true, color: "#fff07a", lineHeight: 1, valign: "middle" }), "holographic"),
      centredText(page, 68, 20, t("studio.tpl.personName"), { font: FONTS.poppins, size: 12, bold: true, color: "#ffffff", valign: "middle", shrink: true, inset: 16 }),
      centredText(page, 88, 12, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 6.5, bold: true, color: "#c4b5fd", spacing: 1.6, upper: true, valign: "middle", shrink: true, inset: 20 }),
      gilded(box("rect", w / 2 - 16, 106, 32, 1.6, solid(violet)), "holographic"),
      ...["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website"].map((key, index) => centredText(page, 116 + index * 14, 12, t(key), { font: FONTS.inter, size: 7, color: "#e5e7eb", valign: "middle", shrink: true, inset: 16 })),
    ]),
  ));
  return withCorner(card, 4);
}

function silverSlate({ t }: TemplateContext) {
  const page = sizeOf(WIDE);
  const { width: w, height: h } = page;
  const silver = "#c7ccd4";
  const slate = "#1f2731";
  const colours = { primary: silver, secondary: "#eef0f3" };
  return design(t("studio.templates.items.silverSlateCard"), [slate, silver, "#4a5565", "#f6f7f9"], sides(t,
    pageOf(WIDE, radial("#3a4553", "#232b35", { cx: 0.3, cy: 0.4, radius: 1.1 }), [
      gilded(box("rect", 10, 10, w - 20, h - 20, NONE, { stroke: stroke(silver, 0.6) }), "silver"),
      gilded(centredText(page, 46, 34, t("studio.tpl.companyName"), { font: FONTS.josefin, size: 18, bold: true, color: silver, spacing: 3, upper: true, valign: "middle", shrink: true, inset: 24 }), "silver"),
      gilded(art("diamondDivider", colours, w / 2 - 60, 86, 120, 10), "silver"),
      centredText(page, 102, 12, t("studio.tpl.companyTagline"), { font: FONTS.josefin, size: 6.5, color: "#cfd5dd", spacing: 2, upper: true, valign: "middle", shrink: true, inset: 30 }),
    ]),
    pageOf(WIDE, radial("#f6f7f9", "#e6e9ee", { cy: 0.4, radius: 1.1 }), [
      gilded(box("rect", 0, 0, 5, h, solid(silver)), "silver"),
      text(24, 20, 150, 22, t("studio.tpl.personName"), { font: FONTS.josefin, size: 14, bold: true, color: slate, valign: "middle", shrink: true }),
      text(24, 43, 150, 12, t("studio.tpl.jobTitle"), { font: FONTS.raleway, size: 6.5, bold: true, color: "#4a5565", spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      gilded(box("rect", 24, 61, 28, 1.2, solid(silver)), "silver"),
      ...contacts(t, 24, 70, 150, { font: FONTS.raleway, color: slate, marker: (x, y) => gilded(box("diamond", x, y, 4, 4, solid(silver)), "silver") }),
      gilded(art("guillocheRosette", colours, w - 78, h / 2 - 29, 58, 58), "silver"),
    ]),
  ));
}

function debossMinimal({ t }: TemplateContext) {
  const page = sizeOf(EU);
  const { width: w, height: h } = page;
  const paper = solid("#f3f2ee");
  const relief = "#e6e4dd";
  const grey = "#5f6268";
  return design(t("studio.templates.items.debossMinimalCard"), ["#1d1f23", grey, relief, "#f3f2ee"], sides(t,
    pageOf(EU, paper, [
      debossed(centredText(page, 52, 42, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 22, bold: true, color: "#f3f2ee", spacing: 1, lineHeight: 1.2, valign: "middle", shrink: true, inset: 20 })),
      debossed(box("rect", w / 2 - 16, 98, 32, 1.6, solid(relief))),
      centredText(page, 108, 12, t("studio.tpl.companyTagline"), { font: FONTS.inter, size: 6.5, color: grey, spacing: 2, upper: true, valign: "middle", shrink: true, inset: 26 }),
    ]),
    pageOf(EU, paper, [
      debossed(box("rect", 10, 10, w - 20, h - 20, NONE, { stroke: stroke(relief, 1) })),
      text(22, 24, w - 44, 20, t("studio.tpl.personName"), { font: FONTS.montserrat, size: 13, bold: true, color: "#1d1f23", valign: "middle", shrink: true }),
      text(22, 45, w - 44, 12, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 6.5, bold: true, color: grey, spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      ...contacts(t, 22, 70, w - 44, { font: FONTS.inter, color: "#2c2f35" }),
    ]),
  ));
}

function miniFoil({ t }: TemplateContext) {
  const page = sizeOf(MINI);
  const { width: w, height: h } = page;
  const gold = "#d4af5a";
  const navy = "#14213d";
  return design(t("studio.templates.items.miniFoilCard"), [navy, gold, "#fbf8f1", "#2a3550"], sides(t,
    pageOf(MINI, radial("#1d2c4f", "#111b33", { cy: 0.4, radius: 1.1 }), [
      gilded(box("rect", 6, 6, w - 12, h - 12, NONE, { stroke: stroke(gold, 0.5) })),
      gilded(centredText(page, 16, 24, t("studio.tpl.personName"), { font: FONTS.cormorant, size: 17, bold: true, color: gold, valign: "middle", shrink: true, inset: 14 })),
      centredText(page, 42, 12, t("studio.tpl.jobTitle"), { font: FONTS.montserrat, size: 6, bold: true, color: "#cdd5e4", spacing: 1.8, upper: true, valign: "middle", shrink: true, inset: 18 }),
      gilded(box("rect", w / 2 - 14, 60, 28, 1, solid(gold))),
    ]),
    pageOf(MINI, solid("#fbf8f1"), [
      gilded(box("rect", 0, 0, 4, h, solid(gold))),
      text(16, 10, 110, 18, t("studio.tpl.companyName"), { font: FONTS.cormorant, size: 12, bold: true, color: navy, valign: "middle", shrink: true }),
      ...contacts(t, 16, 32, 110, { font: FONTS.montserrat, color: "#2a3550", size: 6.5, gap: 13, rows: ["studio.tpl.phone", "studio.tpl.email", "studio.tpl.website"] }),
      qr("https://example.com", w - 62, 12, 52, navy),
    ]),
  ));
}

function verticalCrest({ t }: TemplateContext) {
  const page = sizeOf(VERTICAL);
  const { width: w } = page;
  const gold = "#d4af5a";
  const forest = "#123a2d";
  const paper = "#efe6d3";
  const card = design(t("studio.templates.items.verticalCrestCard"), [forest, gold, paper, "#2b2a24"], sides(t,
    pageOf(VERTICAL, radial("#123a2d", "#06170f", { cy: 0.38, radius: 1.1 }), [
      gilded(art("shield", { primary: gold, secondary: "#f6e3a1" }, w / 2 - 28, 34, 56, 66)),
      gilded(centredText(page, 116, 30, t("studio.tpl.companyName"), { font: FONTS.cinzel, size: 14, bold: true, color: gold, spacing: 2, upper: true, valign: "middle", shrink: true, inset: 14 })),
      centredText(page, 148, 12, t("studio.tpl.companyTagline"), { font: FONTS.raleway, size: 6, bold: true, color: "#e8dcc0", spacing: 1.6, upper: true, valign: "middle", shrink: true, inset: 18 }),
      gilded(box("rect", w / 2 - 18, 174, 36, 1.2, solid(gold))),
    ]),
    pageOf(VERTICAL, radial("#fbf7ee", paper, { cy: 0.4, radius: 1.1 }), [
      embossed(art("shield", { primary: paper, secondary: "#f6efe0" }, w / 2 - 34, 20, 68, 80)),
      centredText(page, 110, 22, t("studio.tpl.personName"), { font: FONTS.cinzel, size: 13, bold: true, color: forest, valign: "middle", shrink: true, inset: 12 }),
      centredText(page, 132, 12, t("studio.tpl.jobTitle"), { font: FONTS.raleway, size: 6.5, bold: true, color: "#7a5c2e", spacing: 1.6, upper: true, valign: "middle", shrink: true, inset: 16 }),
      gilded(box("rect", w / 2 - 14, 152, 28, 1.2, solid(gold))),
      ...CONTACT_KEYS.map((key, index) => centredText(page, 162 + index * 14, 12, t(key), { font: FONTS.raleway, size: 6.5, color: "#2b2a24", valign: "middle", shrink: true, inset: 12 })),
    ]),
  ));
  return withCorner(card, 3);
}

function contactCode(t: Translate): string {
  const [firstName = "", ...rest] = t("studio.tpl.personName").split(/\s+/u);
  return buildVCard({
    ...EMPTY_VCARD,
    firstName,
    lastName: rest.join(" "),
    organization: t("studio.tpl.companyName"),
    title: t("studio.tpl.jobTitle"),
    phone: t("studio.tpl.phone"),
    email: t("studio.tpl.email"),
    website: t("studio.tpl.website"),
    address: t("studio.tpl.address"),
  });
}

function vcardQr({ t }: TemplateContext) {
  const page = sizeOf(EU);
  const { width: w, height: h } = page;
  const deep = "#0f1e46";
  const blue = "#1d4ed8";
  const sun = "#f5b301";
  return design(t("studio.templates.items.vcardQrCard"), [deep, blue, sun, "#eef3ff"], sides(t,
    pageOf(EU, gradient(150, ["#ffffff", "#eef3ff"]), [
      glossed(box("ellipse", 22, 22, 28, 28, solid(blue))),
      glossed(box("ellipse", 38, 22, 28, 28, NONE, { stroke: stroke(sun, 2) })),
      text(22, 60, 170, 22, t("studio.tpl.personName"), { font: FONTS.poppins, size: 15, bold: true, color: deep, valign: "middle", shrink: true }),
      text(22, 82, 170, 12, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 6.5, bold: true, color: blue, spacing: 1.6, upper: true, valign: "middle", shrink: true }),
      box("rect", 0, h - 38, w, 38, gradient(0, [deep, blue])),
      text(22, h - 30, w - 44, 22, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 10, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
    ]),
    pageOf(EU, solid(deep), [
      text(20, 22, 100, 20, t("studio.tpl.companyName"), { font: FONTS.poppins, size: 12, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      ...contacts(t, 20, 52, 100, { font: FONTS.inter, color: "#dbe4ff", size: 6.5, marker: (x, y) => box("ellipse", x, y, 4, 4, solid(sun)) }),
      box("rect", w - 112, 20, 92, 92, solid("#ffffff"), { radius: 10 }),
      qr(contactCode(t), w - 106, 26, 80, deep),
      text(w - 112, 116, 92, 14, t("studio.tpl.scanToSaveContact"), { font: FONTS.inter, size: 6.5, bold: true, color: "#ffffff", align: "center", spacing: 1, upper: true, valign: "middle", shrink: true }),
    ]),
  ));
}

export const FINISH_CARD_TEMPLATES: StudioTemplate[] = [
  { id: "ivoryEmbossCard", category: "cards", size: EU, build: ivoryEmboss },
  { id: "goldFoilNoirCard", category: "cards", size: US, build: goldFoilNoir },
  { id: "letterpressCottonCard", category: "cards", size: EU, build: letterpressCotton },
  { id: "spotUvCharcoalCard", category: "cards", size: WIDE, build: spotUvCharcoal },
  { id: "roseGoldPlumCard", category: "cards", size: EU, build: roseGoldPlum },
  { id: "copperKraftCard", category: "cards", size: US, build: copperKraft },
  { id: "holographicSquareCard", category: "cards", size: SQUARE, build: holographicSquare },
  { id: "silverSlateCard", category: "cards", size: WIDE, build: silverSlate },
  { id: "debossMinimalCard", category: "cards", size: EU, build: debossMinimal },
  { id: "miniFoilCard", category: "cards", size: MINI, build: miniFoil },
  { id: "verticalCrestCard", category: "cards", size: VERTICAL, build: verticalCrest },
  { id: "vcardQrCard", category: "cards", size: EU, build: vcardQr },
];
