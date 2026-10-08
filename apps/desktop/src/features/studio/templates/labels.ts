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

export const LABEL_TEMPLATES: StudioTemplate[] = [
  { id: "eventTicket", category: "labels", size: TICKET, build: eventTicket },
  { id: "raffleTicket", category: "labels", size: RAFFLE, build: raffleTicket },
  { id: "shippingLabel", category: "labels", size: SHIPPING, build: shippingLabel },
  { id: "stickerSheet", category: "labels", size: A4, build: stickerSheet },
  { id: "jarLabels", category: "labels", size: A4, build: jarLabels },
  { id: "addressLabels", category: "labels", size: A4, build: addressLabels },
];
