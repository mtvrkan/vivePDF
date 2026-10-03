import { art, box, design, FONTS, linear, pageOf, qr, rule, sizeOf, solid, text, vrule, type StudioTemplate, type TemplateContext, type TemplateSize } from "./kit";

const TICKET: TemplateSize = { width: 540, height: 198 };
const RAFFLE: TemplateSize = { width: 432, height: 144 };
const SHIPPING: TemplateSize = { width: 297.64, height: 419.53 };
const A4 = "a4" as const;

function eventTicket({ t }: TemplateContext) {
  const page = sizeOf(TICKET);
  const violet = "#4c1d95";
  const pink = "#f472b6";
  const stub = page.width - 150;
  return design(t("studio.templates.items.eventTicket"), [violet, pink], [
    pageOf(TICKET, solid("#ffffff"), [
      box("rect", 0, 0, stub, page.height, linear(120, violet, "#7e22ce")),
      art("arcRings", { primary: pink, secondary: "#c4b5fd" }, stub - 240, -60, 220, 220, { opacity: 0.35 }),
      text(24, 22, stub - 48, 16, t("studio.tpl.admitOne"), { font: FONTS.montserrat, size: 10, bold: true, color: pink, spacing: 4, upper: true }),
      text(24, 44, stub - 60, 70, t("studio.tpl.eventTitle"), { font: FONTS.bebas, size: 46, color: "#ffffff", lineHeight: 0.95, shrink: true, valign: "middle" }),
      ...[["studio.tpl.date", "studio.tpl.eventDate"], ["studio.tpl.location", "studio.tpl.eventPlace"], ["studio.tpl.seat", "studio.tpl.seatValue"]].flatMap(([label, value], index) => {
        const x = 24 + index * ((stub - 48) / 3);
        return [
          text(x, 130, (stub - 48) / 3 - 8, 14, t(label ?? ""), { font: FONTS.montserrat, size: 8, bold: true, color: "#ddd6fe", spacing: 1.5, upper: true, shrink: true }),
          text(x, 146, (stub - 48) / 3 - 8, 30, t(value ?? ""), { font: FONTS.montserrat, size: 10.5, bold: true, color: "#ffffff", lineHeight: 1.2, shrink: true }),
        ];
      }),
      vrule(stub, 10, page.height - 20, "#a78bfa", 1.5, "dashed"),
      qr("TICKET-{n}", stub + 30, 30, 90, violet),
      text(stub + 10, 132, 130, 16, t("studio.tpl.ticketNumber"), { font: FONTS.montserrat, size: 8, bold: true, color: "#6b7280", align: "center", spacing: 1.5, upper: true }),
      text(stub + 10, 150, 130, 24, "#{n}", { font: FONTS.oswald, size: 18, bold: true, color: violet, align: "center" }),
    ]),
  ]);
}

function raffleTicket({ t }: TemplateContext) {
  const page = sizeOf(RAFFLE);
  const red = "#b91c1c";
  const gold = "#facc15";
  const stub = 120;
  return design(t("studio.templates.items.raffleTicket"), [red, gold], [
    pageOf(RAFFLE, solid("#fffbeb"), [
      box("rect", 0, 0, stub, page.height, solid(red)),
      text(8, 20, stub - 16, 14, t("studio.tpl.ticketNumber"), { font: FONTS.oswald, size: 8, color: "#fecaca", align: "center", spacing: 1.5, upper: true }),
      text(8, 38, stub - 16, 30, "{n}", { font: FONTS.oswald, size: 24, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
      rule(14, 90, stub - 28, "#fca5a5", 0.6),
      text(14, 96, stub - 28, 14, t("studio.tpl.nameShort"), { font: FONTS.oswald, size: 7, color: "#fecaca", upper: true }),
      rule(14, 124, stub - 28, "#fca5a5", 0.6),
      text(14, 128, stub - 28, 12, t("studio.tpl.phoneShort"), { font: FONTS.oswald, size: 7, color: "#fecaca", upper: true }),
      vrule(stub, 6, page.height - 12, "#ffffff", 1.2, "dotted"),
      art("starSeal", { primary: gold, secondary: red }, page.width - 106, 22, 90, 90),
      text(page.width - 106, 44, 90, 46, t("studio.tpl.win"), { font: FONTS.abril, size: 18, color: red, align: "center", valign: "middle", shrink: true }),
      text(stub + 16, 18, page.width - stub - 130, 18, t("studio.tpl.raffle"), { font: FONTS.oswald, size: 12, bold: true, color: red, spacing: 4, upper: true, shrink: true }),
      text(stub + 16, 38, page.width - stub - 130, 54, t("studio.tpl.rafflePrize"), { font: FONTS.oswald, size: 24, bold: true, color: "#1f2937", lineHeight: 1.05, upper: true, shrink: true, valign: "middle" }),
      text(stub + 16, 96, page.width - stub - 130, 16, t("studio.tpl.drawDate"), { font: FONTS.inter, size: 9, color: "#4b5563", shrink: true }),
      text(stub + 16, 114, 70, 18, "{n}", { font: FONTS.oswald, size: 13, bold: true, color: red }),
    ]),
  ]);
}

function shippingLabel({ t }: TemplateContext) {
  const page = sizeOf(SHIPPING);
  const ink = "#111827";
  const pad = 16;
  const inner = page.width - pad * 2;
  return design(t("studio.templates.items.shippingLabel"), [ink, "#f59e0b"], [
    pageOf(SHIPPING, solid("#ffffff"), [
      box("rect", pad, pad, inner, page.height - pad * 2, { type: "none" }, { stroke: { color: ink, width: 1.5, dash: "solid" } }),
      text(pad + 10, pad + 8, inner - 20, 14, t("studio.tpl.from"), { font: FONTS.inter, size: 8, bold: true, color: "#6b7280", upper: true, spacing: 1.5 }),
      text(pad + 10, pad + 24, inner - 20, 16, t("studio.tpl.companyName"), { font: FONTS.inter, size: 10, bold: true, color: ink, shrink: true }),
      text(pad + 10, pad + 42, inner - 20, 30, t("studio.tpl.address"), { font: FONTS.inter, size: 8.5, color: "#374151", lineHeight: 1.3, shrink: true }),
      rule(pad, pad + 82, inner, ink, 1.5),
      text(pad + 10, pad + 92, inner - 20, 14, t("studio.tpl.shipTo"), { font: FONTS.inter, size: 8, bold: true, color: "#6b7280", upper: true, spacing: 1.5 }),
      text(pad + 10, pad + 110, inner - 20, 26, t("studio.tpl.clientName"), { font: FONTS.inter, size: 16, bold: true, color: ink, shrink: true }),
      text(pad + 10, pad + 138, inner - 20, 60, t("studio.tpl.address"), { font: FONTS.inter, size: 12, color: ink, lineHeight: 1.35, shrink: true }),
      text(pad + 10, pad + 200, inner - 20, 18, t("studio.tpl.phone"), { font: FONTS.inter, size: 10, color: "#374151", shrink: true }),
      rule(pad, pad + 230, inner, ink, 1.5),
      qr("SHIP-{n}", pad + 10, pad + 244, 100, ink),
      text(pad + 124, pad + 248, inner - 134, 14, t("studio.tpl.trackingNumber"), { font: FONTS.inter, size: 8, bold: true, color: "#6b7280", upper: true, spacing: 1 }),
      text(pad + 124, pad + 264, inner - 134, 22, "VP{n}TR", { font: FONTS.oswald, size: 16, bold: true, color: ink, shrink: true }),
      text(pad + 124, pad + 296, inner - 134, 14, t("studio.tpl.weight"), { font: FONTS.inter, size: 8, bold: true, color: "#6b7280", upper: true, spacing: 1 }),
      text(pad + 124, pad + 312, inner - 134, 20, t("studio.tpl.weightValue"), { font: FONTS.inter, size: 12, bold: true, color: ink, shrink: true }),
      box("rect", pad, page.height - pad - 36, inner, 36, solid(ink)),
      text(pad, page.height - pad - 36, inner, 36, t("studio.tpl.fragile"), { font: FONTS.oswald, size: 16, bold: true, color: "#f59e0b", align: "center", valign: "middle", upper: true, spacing: 4, shrink: true }),
    ]),
  ]);
}

function stickerSheet({ t }: TemplateContext) {
  const page = sizeOf(A4);
  const palette = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24"];
  const columns = 3;
  const rows = 4;
  const side = 150;
  const gapX = (page.width - columns * side) / (columns + 1);
  const gapY = (page.height - rows * side) / (rows + 1);
  return design(t("studio.templates.items.stickerSheet"), palette, [
    pageOf(A4, solid("#ffffff"), [
      ...Array.from({ length: columns * rows }, (_, index) => {
        const x = gapX + (index % columns) * (side + gapX);
        const y = gapY + Math.floor(index / columns) * (side + gapY);
        const color = palette[index % palette.length] ?? "#f472b6";
        return [
          box("ellipse", x, y, side, side, solid(color)),
          box("ellipse", x + 8, y + 8, side - 16, side - 16, { type: "none" }, { stroke: { color: "#ffffff", width: 2, dash: "dashed" } }),
          text(x + 18, y + 34, side - 36, 50, t("studio.tpl.stickerTitle"), { font: FONTS.pacifico, size: 22, color: "#ffffff", align: "center", valign: "middle", shrink: true }),
          text(x + 18, y + 88, side - 36, 22, t("studio.tpl.stickerLine"), { font: FONTS.nunito, size: 11, bold: true, color: "#ffffff", align: "center", upper: true, spacing: 1, shrink: true }),
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
];
