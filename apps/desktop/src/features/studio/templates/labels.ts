import type { StudioElement } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, design, foil, FONTS, gradient, pageOf, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const TICKET: TemplateSize = { width: 540, height: 198 };
const RAFFLE: TemplateSize = { width: 432, height: 144 };
const SHIPPING: TemplateSize = { width: 297.64, height: 419.53 };
const A4 = "a4" as const;

function notches(x: number, height: number, colour: string, radius = 11): StudioElement[] {
  return [box("ellipse", x - radius, -radius, radius * 2, radius * 2, solid(colour)), box("ellipse", x - radius, height - radius, radius * 2, radius * 2, solid(colour))];
}

function eventTicket({ t }: TemplateContext) {
  const page = sizeOf(TICKET);
  const night = "#170d33";
  const violet = "#5b21b6";
  const gold = "#f2d18b";
  const lilac = "#d8ccf5";
  const cream = "#fbf7ee";
  const stub = page.width - 152;
  const column = (stub - 56) / 3;
  return design(t("studio.templates.items.eventTicket"), [night, violet, "#c9a24a", cream], [
    pageOf(TICKET, solid("#ffffff"), [
      box("rect", 0, 0, stub, page.height, gradient(115, [night, "#2e1065", violet])),
      art("sunburst", { primary: "#7c3aed", secondary: "#c9a24a" }, 0, 0, stub, page.height, { opacity: 0.14 }),
      art("arcRings", { primary: "#f472b6", secondary: gold }, stub - 190, -46, 210, 210, { opacity: 0.35 }),
      box("rect", 0, 0, stub, 3, foil("gold", 0)),
      box("rect", 0, page.height - 3, stub, 3, foil("gold", 0)),
      text(28, 22, 200, 14, t("studio.tpl.admitOne"), { font: FONTS.montserrat, size: 8.5, bold: true, color: gold, spacing: 4, upper: true, shrink: true }),
      text(28, 40, stub - 120, 68, t("studio.tpl.eventTitle"), { font: FONTS.bebas, size: 48, color: "#ffffff", lineHeight: 0.95, valign: "middle", shrink: true }),
      box("rect", 28, 116, 40, 2, foil("gold", 0)),
      ...[["studio.tpl.date", "studio.tpl.eventDate"], ["studio.tpl.location", "studio.tpl.eventPlace"], ["studio.tpl.seat", "studio.tpl.seatValue"]].flatMap(([label, value], index) => {
        const x = 28 + index * column;
        return [
          text(x, 132, column - 12, 12, t(label ?? ""), { font: FONTS.montserrat, size: 7, bold: true, color: lilac, spacing: 1.5, upper: true, shrink: true }),
          text(x, 146, column - 12, 30, t(value ?? ""), { font: FONTS.montserrat, size: 10, bold: true, color: "#ffffff", lineHeight: 1.2, shrink: true }),
        ];
      }),
      box("rect", stub, 0, page.width - stub, page.height, radial("#ffffff", cream, { cy: 0.3 })),
      box("rect", page.width - 5, 0, 5, page.height, foil("gold", 90)),
      vrule(stub, 16, page.height - 32, "#b9a8de", 1.4, "dotted"),
      ...notches(stub, page.height, "#ffffff"),
      shadowed(box("rect", stub + 30, 22, 88, 88, solid("#ffffff"), { radius: 8 }), "soft"),
      qr("TICKET-{n}", stub + 34, 26, 80, night),
      text(stub + 10, 122, page.width - stub - 26, 14, t("studio.tpl.ticketNumber"), { font: FONTS.montserrat, size: 7.5, bold: true, color: "#5f5577", align: "center", spacing: 1.5, upper: true, shrink: true }),
      text(stub + 10, 138, page.width - stub - 26, 32, "#{n}", { font: FONTS.bebas, size: 28, color: violet, align: "center", valign: "middle", spacing: 1 }),
    ]),
  ]);
}

function raffleTicket({ t }: TemplateContext) {
  const page = sizeOf(RAFFLE);
  const wine = "#6d1a2d";
  const gold = "#d6b25e";
  const blush = "#f6dcc4";
  const cream = "#fbf3e3";
  const stub = 118;
  const main = stub + 20;
  const mainWidth = page.width - main - 116;
  return design(t("studio.templates.items.raffleTicket"), [wine, gold, cream], [
    pageOf(RAFFLE, radial("#fffaf0", cream, { cx: 0.6, cy: 0.4 }), [
      art("halftone", { primary: wine, secondary: gold }, stub, 0, page.width - stub, page.height, { opacity: 0.18 }),
      box("rect", 0, 0, stub, page.height, gradient(160, ["#7f1d32", "#3f0b17"])),
      box("rect", 7, 7, stub - 14, page.height - 14, { type: "none" }, { radius: 4, stroke: stroke(gold, 0.8) }),
      text(12, 16, stub - 24, 12, t("studio.tpl.ticketNumber"), { font: FONTS.oswald, size: 7.5, color: blush, align: "center", spacing: 1.5, upper: true, shrink: true }),
      text(12, 30, stub - 24, 34, "{n}", { font: FONTS.oswald, size: 26, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
      rule(18, 90, stub - 36, gold, 0.6),
      text(18, 94, stub - 36, 12, t("studio.tpl.nameShort"), { font: FONTS.oswald, size: 7, color: blush, spacing: 1, upper: true, shrink: true }),
      rule(18, 120, stub - 36, gold, 0.6),
      text(18, 124, stub - 36, 12, t("studio.tpl.phoneShort"), { font: FONTS.oswald, size: 7, color: blush, spacing: 1, upper: true, shrink: true }),
      vrule(stub, 12, page.height - 24, wine, 1.2, "dotted"),
      ...notches(stub, page.height, cream, 9),
      text(main, 18, mainWidth, 16, t("studio.tpl.raffle"), { font: FONTS.oswald, size: 11, bold: true, color: wine, spacing: 5, upper: true, shrink: true }),
      text(main, 36, mainWidth, 54, t("studio.tpl.rafflePrize"), { font: FONTS.oswald, size: 22, bold: true, color: "#24121a", lineHeight: 1.05, upper: true, valign: "middle", shrink: true }),
      box("rect", main, 96, 36, 2, foil("gold", 0)),
      text(main, 104, mainWidth, 16, t("studio.tpl.drawDate"), { font: FONTS.inter, size: 9, color: "#5a4048", shrink: true }),
      text(main, 120, mainWidth, 16, "#{n}", { font: FONTS.oswald, size: 11, bold: true, color: wine, spacing: 1 }),
      shadowed(box("burst", page.width - 108, 22, 96, 96, foil("gold", 135), { points: 18, inner: 0.86 }), "soft"),
      box("ellipse", page.width - 96, 34, 72, 72, solid(wine)),
      box("ellipse", page.width - 91, 39, 62, 62, { type: "none" }, { stroke: stroke(gold, 0.8, "dashed") }),
      text(page.width - 92, 50, 64, 40, t("studio.tpl.win"), { font: FONTS.abril, size: 18, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

function shippingLabel({ t }: TemplateContext) {
  const page = sizeOf(SHIPPING);
  const ink = "#111827";
  const amber = "#f59e0b";
  const muted = "#4b5563";
  const pad = 12;
  const inner = page.width - pad * 2;
  const left = pad + 14;
  const width = inner - 28;
  const band = page.height - pad - 56;
  return design(t("studio.templates.items.shippingLabel"), [ink, amber, "#ffffff"], [
    pageOf(SHIPPING, solid("#ffffff"), [
      box("rect", pad, pad, inner, 66, gradient(135, ["#1f2937", ink]), { radius: 6 }),
      box("rect", pad, pad + 60, inner, 6, solid(ink)),
      text(left, pad + 10, width - 48, 12, t("studio.tpl.from"), { font: FONTS.inter, size: 7, bold: true, color: "#fcd34d", spacing: 2, upper: true, shrink: true }),
      text(left, pad + 24, width - 48, 16, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(left, pad + 42, width - 48, 18, t("studio.tpl.address"), { font: FONTS.inter, size: 7.5, color: "#d1d5db", lineHeight: 1.25, shrink: true }),
      box("ellipse", page.width - pad - 46, pad + 17, 32, 32, solid(amber)),
      text(page.width - pad - 46, pad + 17, 32, 32, t("studio.tpl.companyName").trim().charAt(0).toUpperCase(), { font: FONTS.montserrat, size: 15, bold: true, color: ink, align: "center", valign: "middle" }),
      box("rect", pad, pad, inner, page.height - pad * 2, { type: "none" }, { radius: 6, stroke: stroke(ink, 1.6) }),
      text(left, 90, width, 12, t("studio.tpl.shipTo"), { font: FONTS.inter, size: 7.5, bold: true, color: muted, spacing: 2, upper: true, shrink: true }),
      box("rect", left, 106, 3, 92, solid(amber), { radius: 1.5 }),
      text(left + 12, 104, width - 12, 26, t("studio.tpl.clientName"), { font: FONTS.montserrat, size: 17, bold: true, color: ink, valign: "middle", shrink: true }),
      text(left + 12, 134, width - 12, 46, t("studio.tpl.address"), { font: FONTS.inter, size: 12, color: ink, lineHeight: 1.35, shrink: true }),
      text(left + 12, 182, width - 12, 16, t("studio.tpl.phone"), { font: FONTS.inter, size: 9.5, color: muted, valign: "middle", shrink: true }),
      rule(pad, 218, inner, ink, 1.4),
      qr("SHIP-{n}", left, 232, 96, ink),
      text(left + 110, 236, width - 110, 12, t("studio.tpl.trackingNumber"), { font: FONTS.inter, size: 7.5, bold: true, color: muted, spacing: 1.5, upper: true, shrink: true }),
      text(left + 110, 252, width - 110, 26, "VP{n}TR", { font: FONTS.oswald, size: 19, bold: true, color: ink, spacing: 1, valign: "middle", shrink: true }),
      rule(left + 110, 290, width - 110, "#d1d5db", 0.8),
      text(left + 110, 298, width - 110, 12, t("studio.tpl.weight"), { font: FONTS.inter, size: 7.5, bold: true, color: muted, spacing: 1.5, upper: true, shrink: true }),
      text(left + 110, 312, width - 110, 20, t("studio.tpl.weightValue"), { font: FONTS.montserrat, size: 13, bold: true, color: ink, valign: "middle", shrink: true }),
      box("rect", pad, band, inner, page.height - pad - band, solid(amber), { radius: 6 }),
      box("rect", pad, band, inner, 6, solid(amber)),
      art("diagonalHatch", { primary: ink, secondary: ink }, pad + 6, band + 8, 44, 40, { opacity: 0.6 }),
      art("diagonalHatch", { primary: ink, secondary: ink }, page.width - pad - 50, band + 8, 44, 40, { opacity: 0.6 }),
      text(pad + 56, band, inner - 112, page.height - pad - band, t("studio.tpl.fragile"), { font: FONTS.oswald, size: 18, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 5, shrink: true }),
      rule(pad, band, inner, ink, 1.6),
    ]),
  ]);
}

type StickerLook = { from: string; to: string };

function stickerSheet({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const looks: StickerLook[] = [
    { from: "#db2777", to: "#9d174d" },
    { from: "#2563eb", to: "#1e3a8a" },
    { from: "#059669", to: "#065f46" },
    { from: "#ea580c", to: "#9a3412" },
  ];
  const columns = 3;
  const rows = 4;
  const side = 150;
  const gapX = (page.width - columns * side) / (columns + 1);
  const gapY = (page.height - rows * side) / (rows + 1);
  return design(t("studio.templates.items.stickerSheet"), looks.map((look) => look.from), [
    pageOf(A4, solid("#ffffff"), [
      ...Array.from({ length: columns * rows }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = gapX + column * (side + gapX);
        const y = gapY + row * (side + gapY);
        const look = looks[index % looks.length] ?? looks[0];
        const fill = gradient(135, [look.from, look.to]);
        const kind = (row + column) % 3;
        const ring = stroke("#ffffff", 1.6, "dashed");
        const shape =
          kind === 0
            ? [box("ellipse", x, y, side, side, fill), box("ellipse", x + 9, y + 9, side - 18, side - 18, { type: "none" }, { stroke: ring })]
            : kind === 1
              ? [box("burst", x, y, side, side, fill, { points: 22, inner: 0.9 }), box("ellipse", x + 12, y + 12, side - 24, side - 24, { type: "none" }, { stroke: ring })]
              : [box("rect", x + 6, y + 6, side - 12, side - 12, fill, { radius: 30 }), box("rect", x + 14, y + 14, side - 28, side - 28, { type: "none" }, { radius: 22, stroke: ring })];
        return [
          ...shape,
          box("star", x + side / 2 - 7, y + 26, 14, 14, solid("#ffffff"), { points: 4, inner: 0.4, opacity: 0.9 }),
          text(x + 22, y + 42, side - 44, 44, t("studio.tpl.stickerTitle"), { font: FONTS.pacifico, size: 25, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
          rule(x + side / 2 - 14, y + 90, 28, lighter(look.from, 0.5), 1),
          text(x + 30, y + 96, side - 60, 20, t("studio.tpl.stickerLine"), { font: FONTS.nunito, size: 9.5, bold: true, color: "#ffffff", align: "center", valign: "middle", upper: true, spacing: 1, shrink: true }),
        ];
      }).flat(),
    ]),
  ]);
}

function jarLabels({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const flavours = ["#b23a48", "#c8692b", "#6b3a7d", "#b8860b", "#6f7f1a", "#2e4a8b"];
  const side = 230;
  const gapX = (page.width - side * 2) / 3;
  const gapY = (page.height - side * 3) / 4;
  return design(t("studio.templates.items.jarLabels"), flavours.slice(0, 3), [
    pageOf(A4, solid("#ffffff"), [
      ...flavours.flatMap((colour, index) => {
        const x = gapX + (index % 2) * (side + gapX);
        const y = gapY + Math.floor(index / 2) * (side + gapY);
        const ink = darker(colour, 0.38);
        const centre = x + side / 2;
        return [
          box("ellipse", x, y, side, side, radial("#fffdf8", lighter(colour, 0.86), { radius: 0.75 }), { stroke: stroke(colour, 2.5) }),
          box("ellipse", x + 9, y + 9, side - 18, side - 18, { type: "none" }, { stroke: stroke(lighter(colour, 0.2), 0.8) }),
          box("ellipse", x + 14, y + 14, side - 28, side - 28, { type: "none" }, { stroke: stroke(lighter(colour, 0.4), 0.8, "dotted") }),
          art("laurel", { primary: colour, secondary: colour }, centre - 24, y + 24, 48, 46),
          text(x + 44, y + 76, side - 88, 14, t("studio.tpl.extras.jarHomemade"), { font: FONTS.cinzel, size: 8.5, bold: true, color: ink, align: "center", spacing: 3, upper: true, shrink: true }),
          text(x + 26, y + 92, side - 52, 54, t(`studio.tpl.extras.jarFlavour${index + 1}`), { font: FONTS.greatVibes, size: 32, color: darker(colour, 0.55), align: "center", valign: "middle", lineHeight: 1, shrink: true }),
          art("diamondDivider", { primary: colour, secondary: colour }, centre - 46, y + 148, 92, 8),
          text(x + 40, y + 160, side - 80, 14, t("studio.tpl.extras.jarSubtitle"), { font: FONTS.lora, size: 8.5, italic: true, color: darker(colour, 0.5), align: "center", shrink: true }),
          box("rect", centre - 56, y + 182, 112, 22, solid(darker(colour, 0.3)), { radius: 11 }),
          text(centre - 52, y + 182, 104, 22, t("studio.tpl.extras.jarSeason"), { font: FONTS.cinzel, size: 7.5, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 1.5, upper: true, shrink: true }),
        ];
      }),
    ]),
  ]);
}

function addressLabels({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const ink = "#1e293b";
  const accent = "#0f766e";
  const width = 180;
  const height = 108;
  const gap = 7.09;
  const left = (page.width - width * 3 - gap * 2) / 2;
  const top = (page.height - height * 7) / 2;
  return design(t("studio.templates.items.addressLabels"), [ink, accent, "#14b8a6"], [
    pageOf(A4, solid("#ffffff"), [
      ...Array.from({ length: 21 }, (_, index) => {
        const x = left + (index % 3) * (width + gap);
        const y = top + Math.floor(index / 3) * height;
        return [
          box("rect", x, y, width, height, { type: "none" }, { radius: 8, stroke: stroke("#cbd5e1", 0.6, "dashed") }),
          art("botanicalSprig", { primary: "#99d5cb", secondary: "#c7e8e2" }, x + width - 36, y + 18, 24, 48, { rotation: 18, opacity: 0.8 }),
          box("rect", x + 14, y + 20, 3, 68, gradient(180, ["#14b8a6", accent]), { radius: 1.5 }),
          text(x + 26, y + 18, width - 64, 18, t("studio.tpl.clientName"), { font: FONTS.montserrat, size: 10.5, bold: true, color: ink, valign: "middle", shrink: true }),
          rule(x + 26, y + 40, 22, "#5eead4", 1),
          text(x + 26, y + 46, width - 44, 28, t("studio.tpl.extras.labelAddress"), { font: FONTS.inter, size: 8, color: "#475569", lineHeight: 1.35, shrink: true }),
          text(x + 26, y + 76, width - 44, 12, t("studio.tpl.extras.labelCountry"), { font: FONTS.montserrat, size: 7, bold: true, color: accent, spacing: 1.5, upper: true, shrink: true }),
        ];
      }).flat(),
    ]),
  ]);
}

const PRIORITY: TemplateSize = { width: 288, height: 432 };

function jarLabelsApothecary({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const flavours = ["#9e2a3a", "#b3541e", "#5b2d6e", "#8a6410", "#4f6118", "#24407a"];
  const kraft = "#e2c79f";
  const ink = "#3b2414";
  const width = 250;
  const height = 236;
  const gapX = (page.width - width * 2) / 3;
  const gapY = (page.height - height * 3) / 4;
  return design(t("studio.templates.items.jarLabelsApothecary"), [ink, kraft, ...flavours.slice(0, 2)], [
    pageOf(A4, solid("#ffffff"), [
      ...flavours.flatMap((colour, index) => {
        const x = gapX + (index % 2) * (width + gapX);
        const y = gapY + Math.floor(index / 2) * (height + gapY);
        const centre = x + width / 2;
        const band = darker(colour, 0.3);
        const sprig = { primary: colour, secondary: darker(colour, 0.2) };
        return [
          shadowed(box("octagon", x, y, width, height, gradient(160, [kraft, "#cfab78"]), { stroke: stroke(ink, 1.4) }), "soft"),
          art("halftone", { primary: ink, secondary: ink }, x + 20, y + 20, width - 40, height - 40, { opacity: 0.05 }),
          box("octagon", x + 8, y + 8, width - 16, height - 16, { type: "none" }, { stroke: stroke(ink, 0.6, "dashed") }),
          box("rect", centre - 92, y + 30, 30, 22, solid(darker(colour, 0.5))),
          box("rect", centre + 62, y + 30, 30, 22, solid(darker(colour, 0.5))),
          box("triangle", centre - 98, y + 33, 16, 16, solid(kraft), { rotation: 90 }),
          box("triangle", centre + 82, y + 33, 16, 16, solid("#d8b98a"), { rotation: -90 }),
          shadowed(box("rect", centre - 72, y + 22, 144, 24, gradient(90, [band, colour, band])), "soft"),
          text(centre - 66, y + 22, 132, 24, t("studio.tpl.extras.jarHomemade"), { font: FONTS.josefin, size: 9, bold: true, color: "#fff8ec", align: "center", valign: "middle", spacing: 3, upper: true, shrink: true }),
          art("botanicalSprig", sprig, x + 22, y + 66, 28, 62, { rotation: -18, opacity: 0.9 }),
          art("botanicalSprig", sprig, x + width - 50, y + 66, 28, 62, { rotation: 18, opacity: 0.9 }),
          text(x + 54, y + 60, width - 108, 70, t(`studio.tpl.extras.jarFlavour${index + 1}`), { font: FONTS.abril, size: 24, color: ink, align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
          art("diamondDivider", { primary: colour, secondary: ink }, centre - 50, y + 134, 100, 9),
          text(x + 34, y + 148, width - 68, 16, t("studio.tpl.extras.jarSubtitle"), { font: FONTS.josefin, size: 9, color: ink, align: "center", valign: "middle", shrink: true }),
          rule(x + 34, y + 172, width - 68, ink, 0.6),
          text(x + 34, y + 176, (width - 68) / 2 - 6, 16, t("studio.tpl.jarLabelsApothecaryWeight"), { font: FONTS.josefin, size: 8.5, bold: true, color: ink, valign: "middle", spacing: 0.5, shrink: true }),
          text(centre + 6, y + 176, (width - 68) / 2 - 6, 16, `${t("studio.tpl.jarLabelsApothecaryBatch")} #{n}`, { font: FONTS.josefin, size: 8.5, bold: true, color: ink, align: "right", valign: "middle", spacing: 0.5, shrink: true }),
          rule(x + 34, y + 196, width - 68, ink, 0.6),
          text(x + 40, y + 202, width - 80, 16, t("studio.tpl.extras.jarSeason"), { font: FONTS.abril, size: 10, color: darker(colour, 0.45), align: "center", valign: "middle", spacing: 1, shrink: true }),
        ];
      }),
    ]),
  ]);
}

function barcode(x: number, y: number, width: number, height: number, colour: string): StudioElement[] {
  const pattern = [3, 1, 1, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 1, 1, 3, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2, 3, 1, 1, 2, 1, 1, 3, 2, 1, 2, 1, 1, 2, 3, 1];
  const total = pattern.reduce((sum, value) => sum + value, 0);
  const unit = width / total;
  let left = x;
  return pattern.flatMap((value, index) => {
    const start = left;
    left += value * unit;
    return index % 2 === 0 ? [box("rect", start, y, value * unit, height, solid(colour))] : [];
  });
}

function shippingPriority({ t }: TemplateContext) {
  const page = sizeOf(PRIORITY);
  const ink = "#0b1220";
  const red = "#c8102e";
  const navy = "#1e3a8a";
  const muted = "#475569";
  const pad = 14;
  const inner = page.width - pad * 2;
  const top = 18;
  const bottom = page.height - 18;
  const left = pad + 12;
  const width = inner - 24;
  const priority = t("studio.tpl.shippingPriorityTitle");
  const stripes = Math.ceil((page.width + 10) / 22);
  const bracket = (x: number, y: number, flipX: boolean, flipY: boolean): StudioElement[] => [rule(flipX ? x - 16 : x, y, 16, ink, 2), vrule(x, flipY ? y - 16 : y, 16, ink, 2)];
  return design(t("studio.templates.items.shippingPriority"), [ink, red, navy, "#ffffff"], [
    pageOf(PRIORITY, solid("#ffffff"), [
      ...Array.from({ length: stripes }, (_, index) => box("parallelogram", index * 22 - 10, 0, 16, 10, solid(index % 2 === 0 ? red : navy))),
      ...Array.from({ length: stripes }, (_, index) => box("parallelogram", index * 22 - 10, page.height - 10, 16, 10, solid(index % 2 === 0 ? navy : red))),
      box("rect", pad, top, inner, bottom - top, { type: "none" }, { radius: 4, stroke: stroke(ink, 1.6) }),
      box("rect", pad, top, 92, 92, gradient(135, ["#1f2937", ink]), { radius: 4 }),
      text(pad, top + 2, 92, 90, priority.trim().charAt(0).toUpperCase(), { font: FONTS.bebas, size: 76, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.05 }),
      vrule(pad + 92, top, 92, ink, 1.6),
      text(pad + 104, top + 12, inner - 116, 14, t("studio.tpl.shippingPriorityPaid"), { font: FONTS.inter, size: 8.5, bold: true, color: ink, spacing: 1.5, upper: true, valign: "middle", shrink: true }),
      rule(pad + 104, top + 32, 40, red, 1.6),
      text(pad + 104, top + 40, inner - 116, 16, t("studio.tpl.shippingPriorityService"), { font: FONTS.inter, size: 9.5, bold: true, color: red, valign: "middle", shrink: true }),
      text(pad + 104, top + 60, inner - 116, 14, "{date}", { font: FONTS.inter, size: 8.5, color: muted, valign: "middle" }),
      text(pad + 104, top + 74, inner - 116, 14, "#{n}", { font: FONTS.inter, size: 8.5, color: muted, valign: "middle" }),
      box("rect", pad, top + 92, inner, 38, gradient(90, [red, darker(red, 0.3)])),
      box("chevron", pad + 10, top + 103, 14, 16, solid("#ffffff"), { opacity: 0.85 }),
      box("chevron", pad + inner - 24, top + 103, 14, 16, solid("#ffffff"), { opacity: 0.85 }),
      text(pad + 32, top + 92, inner - 64, 38, priority, { font: FONTS.bebas, size: 25, color: "#ffffff", align: "center", valign: "middle", spacing: 4, upper: true, shrink: true }),
      text(left, 158, 150, 12, t("studio.tpl.from"), { font: FONTS.inter, size: 7, bold: true, color: muted, spacing: 2, upper: true, shrink: true }),
      text(left, 172, 160, 16, t("studio.tpl.companyName"), { font: FONTS.inter, size: 9.5, bold: true, color: ink, valign: "middle", shrink: true }),
      text(left, 189, 160, 22, t("studio.tpl.address"), { font: FONTS.inter, size: 8, color: muted, lineHeight: 1.3, shrink: true }),
      text(page.width - pad - 82, 158, 70, 12, t("studio.tpl.weight"), { font: FONTS.inter, size: 7, bold: true, color: muted, spacing: 2, upper: true, align: "right", shrink: true }),
      text(page.width - pad - 82, 172, 70, 30, t("studio.tpl.weightValue"), { font: FONTS.bebas, size: 24, color: navy, align: "right", valign: "middle", shrink: true }),
      rule(pad, 218, inner, ink, 1.2),
      ...bracket(left - 2, 228, false, false),
      ...bracket(page.width - left + 2, 228, true, false),
      ...bracket(left - 2, 316, false, true),
      ...bracket(page.width - left + 2, 316, true, true),
      text(left + 10, 234, width - 20, 12, t("studio.tpl.shipTo"), { font: FONTS.inter, size: 7.5, bold: true, color: red, spacing: 2, upper: true, shrink: true }),
      text(left + 10, 248, width - 20, 26, t("studio.tpl.clientName"), { font: FONTS.inter, size: 17, bold: true, color: ink, valign: "middle", shrink: true }),
      text(left + 10, 276, width - 20, 22, t("studio.tpl.address"), { font: FONTS.inter, size: 11, color: ink, lineHeight: 1.3, shrink: true }),
      text(left + 10, 298, width - 20, 14, t("studio.tpl.phone"), { font: FONTS.inter, size: 8.5, color: muted, valign: "middle", shrink: true }),
      rule(pad, 326, inner, ink, 1.2),
      text(left, 334, width, 12, t("studio.tpl.trackingNumber"), { font: FONTS.inter, size: 7, bold: true, color: muted, spacing: 2, upper: true, shrink: true }),
      ...barcode(left, 350, width, 40, ink),
      text(left, 394, width, 16, "VP {n} TR", { font: FONTS.inter, size: 9.5, bold: true, color: ink, align: "center", valign: "middle", spacing: 4 }),
    ]),
  ]);
}

function candleLabels({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const width = 250;
  const height = 360;
  const gapX = (page.width - width * 2) / 3;
  const gapY = (page.height - height * 2) / 3;
  const looks = [
    { fill: gradient(160, ["#2a2622", "#121110"]), ink: "#ffffff", soft: "#d9cfbf", brand: "#e8d3a2", line: "#c9a24a" },
    { fill: gradient(160, ["#fbf5ea", "#efe2cc"]), ink: "#2b2117", soft: "#5a4a3a", brand: "#6e5016", line: "#b08a3c" },
  ];
  return design(t("studio.templates.items.candleLabels"), ["#121110", "#c9a24a", "#fbf5ea"], [
    pageOf(A4, radial("#faf8f4", "#efebe4", { radius: 1.1 }), [
      ...[0, 1, 2, 3].flatMap((index) => {
        const x = gapX + (index % 2) * (width + gapX);
        const y = gapY + Math.floor(index / 2) * (height + gapY);
        const look = looks[(index + Math.floor(index / 2)) % 2] ?? looks[0];
        const centre = x + width / 2;
        const gold = { primary: look.line, secondary: look.line };
        return [
          shadowed(box("rect", x, y, width, height, foil("gold", 135), { radius: 8 }), "lifted"),
          box("rect", x + 5, y + 5, width - 10, height - 10, look.fill, { radius: 5 }),
          box("rect", x + 13, y + 13, width - 26, height - 26, { type: "none" }, { radius: 2, stroke: stroke(look.line, 0.7) }),
          box("rect", x + 17, y + 17, width - 34, height - 34, { type: "none" }, { radius: 1, stroke: stroke(look.line, 0.35) }),
          art("decoFan", { primary: look.line, secondary: look.line }, centre - 34, y + 40, 68, 38),
          text(x + 30, y + 88, width - 60, 16, t("studio.tpl.companyName"), { font: FONTS.cinzel, size: 8.5, bold: true, color: look.brand, align: "center", valign: "middle", spacing: 3, upper: true, shrink: true }),
          text(x + 30, y + 110, width - 60, 20, `N° 0${index + 1}`, { font: FONTS.cormorant, size: 13, italic: true, color: look.brand, align: "center", valign: "middle" }),
          text(x + 26, y + 134, width - 52, 92, t(`studio.tpl.candleLabelsScent${index + 1}`), { font: FONTS.cormorant, size: 36, bold: true, italic: true, color: look.ink, align: "center", valign: "middle", lineHeight: 1.05, shrink: true }),
          art("diamondDivider", gold, centre - 56, y + 234, 112, 10),
          text(x + 28, y + 252, width - 56, 36, t(`studio.tpl.candleLabelsNotes${index + 1}`), { font: FONTS.cormorant, size: 13.5, italic: true, color: look.soft, align: "center", valign: "middle", lineHeight: 1.25, shrink: true }),
          rule(centre - 20, y + 298, 40, look.line, 0.8),
          text(x + 28, y + 306, width - 56, 16, t("studio.tpl.candleLabelsLine"), { font: FONTS.cinzel, size: 7.5, bold: true, color: look.brand, align: "center", valign: "middle", spacing: 1.2, upper: true, shrink: true }),
          text(x + 28, y + 324, width - 56, 18, t("studio.tpl.candleLabelsBurn"), { font: FONTS.cormorant, size: 11.5, color: look.soft, align: "center", valign: "middle", shrink: true }),
        ];
      }),
    ]),
  ]);
}

function giftTagsHanging({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const backdrop = "#f5f2ed";
  const width = 118;
  const height = 320;
  const gap = 22;
  const left = (page.width - width * 4 - gap * 3) / 2;
  const rows = [86, 470];
  const titles = ["studio.tpl.extras.giftTagTitle1", "studio.tpl.extras.giftTagTitle2", "studio.tpl.extras.giftTagTitle3"];
  const looks = [
    { fill: gradient(170, ["#2f5d46", "#1b3a2b"]), ink: "#ffffff", line: "#c9e0d2", foil: "gold" as const, ornament: "botanicalSprig", pattern: "diagonalHatch", accent: "#d9b46a" },
    { fill: gradient(170, ["#dcbf94", "#c79f6c"]), ink: "#4a2a14", line: "#6b4423", foil: "copper" as const, ornament: "starSeal", pattern: "halftone", accent: "#9c2a2a" },
    { fill: gradient(170, ["#24305a", "#121a33"]), ink: "#ffffff", line: "#c7cfe6", foil: "silver" as const, ornament: "laurel", pattern: "honeycomb", accent: "#c7ccd4" },
    { fill: gradient(170, ["#f8e0da", "#efc5bc"]), ink: "#6d1a2d", line: "#8a3a4a", foil: "rose" as const, ornament: "heart", pattern: "topographic", accent: "#b5576d" },
  ];
  const twine = (x1: number, y1: number, x2: number, y2: number): StudioElement => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return { ...rule((x1 + x2) / 2 - length / 2, (y1 + y2) / 2, length, "#a07a52", 1.2), rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI };
  };
  return design(t("studio.templates.items.giftTagsHanging"), ["#2f5d46", "#c79f6c", "#24305a", "#efc5bc"], [
    pageOf(A4, solid(backdrop), [
      ...rows.flatMap((y, row) =>
        looks.flatMap((look, column) => {
          const index = row * 4 + column;
          const x = left + column * (width + gap);
          const centre = x + width / 2;
          const colours = { primary: look.accent, secondary: look.accent };
          const ornament =
            look.ornament === "heart"
              ? box("heart", centre - 11, y + 70, 22, 20, solid(look.accent))
              : look.ornament === "starSeal"
                ? art("starSeal", { primary: look.accent, secondary: "#f6e3a1" }, centre - 22, y + 58, 44, 44)
                : look.ornament === "laurel"
                  ? art("laurel", colours, centre - 26, y + 58, 52, 48)
                  : art("botanicalSprig", colours, centre - 15, y + 52, 30, 60);
          return [
            twine(centre, y + 22, centre - 22, y - 48),
            twine(centre, y + 22, centre + 18, y - 52),
            shadowed(box("rect", x, y, width, height, look.fill, { radius: 6 }), "soft"),
            art(look.pattern, { primary: look.line, secondary: look.accent }, x, y + height - 110, width, 110, { opacity: 0.18 }),
            box("rect", x - 15, y - 15, 30, 30, solid(backdrop), { rotation: 45 }),
            box("rect", x + width - 15, y - 15, 30, 30, solid(backdrop), { rotation: 45 }),
            box("ellipse", centre - 11, y + 12, 22, 22, foil(look.foil, 135)),
            box("ellipse", centre - 6, y + 17, 12, 12, solid(backdrop)),
            ornament,
            text(x + 8, y + 122, width - 16, 70, t(titles[index % titles.length] ?? ""), { font: FONTS.greatVibes, size: 30, color: look.ink, align: "center", valign: "middle", lineHeight: 1.05, shrink: true }),
            art("dotsDivider", colours, centre - 26, y + 200, 52, 6),
            text(x + 12, y + 220, 40, 18, t("studio.tpl.extras.giftTo"), { font: FONTS.montserrat, size: 7.5, bold: true, color: look.ink, upper: true, spacing: 1, valign: "bottom", shrink: true }),
            rule(x + 54, y + 236, width - 66, look.line, 0.8),
            text(x + 12, y + 248, 40, 18, t("studio.tpl.voucherFrom"), { font: FONTS.montserrat, size: 7.5, bold: true, color: look.ink, upper: true, spacing: 1, valign: "bottom", shrink: true }),
            rule(x + 54, y + 264, width - 66, look.line, 0.8),
            box("rect", x + 12, y + height - 18, width - 24, 2, foil(look.foil, 0)),
          ];
        }),
      ),
    ]),
  ]);
}

function nameBadgesHello({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const colours = ["#c2410c", "#1d4ed8", "#047857", "#6d28d9"];
  const width = 254;
  const height = 176;
  const gapX = (page.width - width * 2) / 3;
  const gapY = (page.height - height * 4) / 5;
  return design(t("studio.templates.items.nameBadgesHello"), colours, [
    pageOf(A4, solid("#ffffff"), [
      ...Array.from({ length: 8 }, (_, index) => {
        const x = gapX + (index % 2) * (width + gapX);
        const y = gapY + Math.floor(index / 2) * (height + gapY);
        const colour = colours[(index + Math.floor(index / 2)) % colours.length] ?? colours[0];
        return [
          shadowed(box("rect", x, y, width, height, gradient(135, [colour, darker(colour, 0.28)]), { radius: 18 }), "soft", colour),
          art("halftone", { primary: "#ffffff", secondary: "#ffffff" }, x, y, width, 70, { opacity: 0.12 }),
          box("ellipse", x + width - 70, y - 30, 110, 90, solid("#ffffff"), { opacity: 0.08 }),
          text(x + 12, y + 8, width - 24, 44, t("studio.tpl.nameBadgesHelloTitle"), { font: FONTS.bebas, size: 40, color: "#ffffff", align: "center", valign: "middle", spacing: 6, upper: true, lineHeight: 1.05, shrink: true }),
          text(x + 12, y + 50, width - 24, 16, t("studio.tpl.nameBadgesHelloLine"), { font: FONTS.inter, size: 10.5, bold: true, color: "#ffffff", align: "center", valign: "middle", spacing: 1, shrink: true }),
          shadowed(box("rect", x + 10, y + 74, width - 20, height - 98, solid("#ffffff"), { radius: 10 }), "soft"),
          text(x + 22, y + 78, width - 44, 52, t("studio.tpl.personName"), { font: FONTS.caveat, size: 36, bold: true, color: "#1f2937", align: "center", valign: "middle", lineHeight: 1.1, shrink: true }),
          rule(x + 34, y + 132, width - 68, "#d1d5db", 0.8, "dashed"),
          text(x + 22, y + 136, width - 44, 14, t("studio.tpl.companyName"), { font: FONTS.inter, size: 8.5, color: "#4b5563", align: "center", valign: "middle", spacing: 0.5, shrink: true }),
          box("rect", x + width / 2 - 14, y + height - 15, 28, 4, solid("#ffffff"), { radius: 2, opacity: 0.7 }),
        ];
      }).flat(),
    ]),
  ]);
}

export const LABEL_TEMPLATES: StudioTemplate[] = [
  { id: "eventTicket", category: "labels", size: TICKET, build: eventTicket },
  { id: "raffleTicket", category: "labels", size: RAFFLE, build: raffleTicket },
  { id: "shippingLabel", category: "labels", size: SHIPPING, build: shippingLabel },
  { id: "stickerSheet", category: "labels", size: A4, build: stickerSheet },
  { id: "jarLabels", category: "labels", size: A4, build: jarLabels },
  { id: "addressLabels", category: "labels", size: A4, build: addressLabels },
  { id: "jarLabelsApothecary", category: "labels", size: A4, build: jarLabelsApothecary },
  { id: "shippingPriority", category: "labels", size: PRIORITY, build: shippingPriority },
  { id: "candleLabels", category: "labels", size: A4, build: candleLabels },
  { id: "giftTagsHanging", category: "labels", size: A4, build: giftTagsHanging },
  { id: "nameBadgesHello", category: "labels", size: A4, build: nameBadgesHello },
];
