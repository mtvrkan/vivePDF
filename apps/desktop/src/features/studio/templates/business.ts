import type { StudioElement, StudioTextAlign } from "@/types/studio";
import { darker, lighter } from "../ornaments/paint";
import { art, box, design, foil, FONTS, gradient, pageOf, photoSlot, qr, radial, rule, shadowed, sizeOf, solid, stroke, text, vrule, type StudioTemplate, type TemplateContext } from "./kit";
import { PALETTES, paletteList } from "./palettes";

type Translate = TemplateContext["t"];

const A4 = "a4" as const;
const { width: W, height: H } = sizeOf(A4);
const M = 56;
const RECEIPT = { width: 226.77, height: 460 };
const INNER = W - M * 2;
const CONTACTS = ["studio.tpl.address", "studio.tpl.phone", "studio.tpl.email", "studio.tpl.website"];

function initial(t: Translate): string {
  return t("studio.tpl.companyName").trim().charAt(0).toUpperCase() || "V";
}

function monogram(t: Translate, x: number, y: number, side: number, fill: string, letter: string, font: string, ring?: string): StudioElement[] {
  return [
    shadowed(box("rect", x, y, side, side, solid(fill), { radius: side * 0.24 }), "soft"),
    ...(ring ? [box("rect", x + 4, y + 4, side - 8, side - 8, { type: "none" }, { radius: side * 0.24 - 3, stroke: stroke(ring, 0.8) })] : []),
    text(x, y, side, side, initial(t), { font, size: side * 0.5, bold: true, color: letter, align: "center", valign: "middle" }),
  ];
}

function brand(t: Translate, x: number, y: number, ink: string, muted: string, display: string, body: string, width = 240): StudioElement[] {
  return [
    text(x, y, width, 22, t("studio.tpl.companyName"), { font: display, size: 15, bold: true, color: ink, valign: "middle", shrink: true }),
    text(x, y + 24, width, 14, t("studio.tpl.companyTagline"), { font: body, size: 8, color: muted, spacing: 1.2, upper: true, shrink: true }),
  ];
}

function contactRow(t: Translate, y: number, color: string, font: string, keys = CONTACTS): StudioElement[] {
  const column = INNER / keys.length;
  return keys.map((key, index) => text(M + index * column, y, column - 10, 26, t(key), { font, size: 8, color, lineHeight: 1.3, align: index === 0 ? "left" : index === keys.length - 1 ? "right" : "center", shrink: true }));
}

function party(t: Translate, x: number, y: number, labelKey: string, label: string, ink: string, muted: string, display: string, body: string, width = 240): StudioElement[] {
  return [
    text(x, y, width, 14, t(labelKey), { font: body, size: 7.5, bold: true, color: label, spacing: 1.8, upper: true, shrink: true }),
    text(x, y + 20, width, 22, t("studio.tpl.clientName"), { font: display, size: 14, bold: true, color: ink, valign: "middle", shrink: true }),
    text(x, y + 46, width, 30, t("studio.tpl.address"), { font: body, size: 9.5, color: muted, lineHeight: 1.4, shrink: true }),
  ];
}

function field(x: number, y: number, width: number, label: string, value: string, labelColor: string, valueColor: string, font: string, valueSize = 11, align: StudioTextAlign = "left"): StudioElement[] {
  return [
    text(x, y, width, 14, label, { font, size: 7.5, bold: true, color: labelColor, spacing: 1.5, upper: true, align, shrink: true }),
    text(x, y + 16, width, 18, value, { font, size: valueSize, bold: true, color: valueColor, align, valign: "middle", shrink: true }),
  ];
}

function pairs(x: number, y: number, width: number, rows: [string, string][], label: string, value: string, font: string, step = 20): StudioElement[] {
  return rows.flatMap(([name, amount], index) => [
    text(x, y + index * step, width * 0.55, 16, name, { font, size: 9.5, color: label, valign: "middle", shrink: true }),
    text(x + width * 0.55, y + index * step, width * 0.45, 16, amount, { font, size: 9.5, bold: true, color: value, align: "right", valign: "middle", shrink: true }),
  ]);
}

type TableLook = { font: string; size: number; ink: string; head: string; headInk: string; line: string; band: boolean; zebra?: string; strong?: number; aligns: StudioTextAlign[] };

function table(x: number, y: number, columns: number[], header: string[], rows: string[][], rowHeight: number, look: TableLook): StudioElement[] {
  const width = columns.reduce((sum, column) => sum + column, 0);
  const starts = columns.map((_, index) => x + columns.slice(0, index).reduce((sum, column) => sum + column, 0));
  const headHeight = 30;
  const cells = (row: string[], top: number, height: number, head: boolean) =>
    row.map((cell, index) =>
      text(starts[index] + 10, top, (columns[index] ?? 0) - 20, height, cell, {
        font: look.font,
        size: head ? look.size - 2 : look.size,
        bold: head || index === look.strong,
        color: head ? look.headInk : look.ink,
        spacing: head ? 1.2 : 0,
        upper: head,
        align: look.aligns[index] ?? "left",
        valign: "middle",
        shrink: true,
      }),
    );
  return [
    look.band ? box("rect", x, y, width, headHeight, solid(look.head), { radius: 6 }) : rule(x, y + headHeight, width, look.head, 1.4),
    ...cells(header, y, headHeight, true),
    ...rows.flatMap((row, index) => {
      const top = y + headHeight + index * rowHeight;
      return [...(look.zebra && index % 2 === 1 ? [box("rect", x, top, width, rowHeight, solid(look.zebra))] : []), ...cells(row, top, rowHeight, false), rule(x, top + rowHeight, width, look.line, 0.6)];
    }),
  ];
}

function itemRows(t: Translate, count: number): string[][] {
  return Array.from({ length: count }, () => [t("studio.tpl.itemName"), "1", t("studio.tpl.price"), t("studio.tpl.price")]);
}

function itemHeader(t: Translate): string[] {
  return [t("studio.tpl.description"), t("studio.tpl.quantity"), t("studio.tpl.unitPrice"), t("studio.tpl.amount")];
}

function letterhead({ t }: TemplateContext) {
  const palette = PALETTES.ivoryNavy;
  const body = "#2b3548";
  const footer = H - 52;
  return design(t("studio.templates.items.letterhead"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", 0, 0, W, 6, foil("gold", 0)),
      art("guillocheRosette", { primary: palette.accent, secondary: palette.accent2 }, W - 300, H - 380, 320, 320, { opacity: 0.06 }),
      ...monogram(t, M, 44, 44, palette.accent, palette.accent2, FONTS.playfair, palette.accent2),
      ...brand(t, M + 60, 45, palette.ink, palette.muted, FONTS.playfair, FONTS.inter),
      text(W - M - 200, 48, 200, 16, t("studio.tpl.phone"), { font: FONTS.inter, size: 8.5, color: palette.muted, align: "right", shrink: true }),
      text(W - M - 200, 66, 200, 16, t("studio.tpl.email"), { font: FONTS.inter, size: 8.5, color: palette.muted, align: "right", shrink: true }),
      rule(M, 116, INNER, "#e2e5ec", 0.8),
      box("rect", M, 115, 56, 2, foil("gold", 0)),
      ...party(t, M, 144, "studio.tpl.to", palette.accent, palette.ink, palette.muted, FONTS.playfair, FONTS.inter, 280),
      text(W - M - 200, 144, 200, 16, t("studio.tpl.letterDate"), { font: FONTS.inter, size: 9.5, color: palette.muted, align: "right", shrink: true }),
      text(M, 248, INNER, 22, t("studio.tpl.letterSubject"), { font: FONTS.inter, size: 11.5, bold: true, color: palette.ink, valign: "middle", shrink: true }),
      text(M, 284, INNER, 368, t("studio.tpl.letterBody"), { font: FONTS.sourceSerif, size: 11.5, color: body, lineHeight: 1.65, shrink: true }),
      text(M, 664, 260, 18, t("studio.tpl.regards"), { font: FONTS.sourceSerif, size: 11.5, color: body, shrink: true }),
      text(M, 688, 260, 30, t("studio.tpl.personName"), { font: FONTS.playfair, size: 20, italic: true, color: palette.accent, valign: "middle", shrink: true }),
      text(M, 722, 260, 16, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 9, color: palette.muted, spacing: 0.5, shrink: true }),
      box("rect", 0, footer, W, H - footer, gradient(90, [palette.accent, darker(palette.accent, 0.3)])),
      box("rect", 0, footer, W, 2, foil("gold", 0)),
      text(M, footer + 2, INNER / 2, H - footer - 2, t("studio.tpl.address"), { font: FONTS.inter, size: 8.5, color: "#e6e9f2", valign: "middle", shrink: true }),
      text(M + INNER / 2, footer + 2, INNER / 2, H - footer - 2, t("studio.tpl.website"), { font: FONTS.inter, size: 8.5, bold: true, color: lighter(palette.accent2, 0.3), align: "right", spacing: 1, valign: "middle", shrink: true }),
    ]),
  ]);
}

function invoice({ t }: TemplateContext) {
  const palette = PALETTES.emeraldBrass;
  const head = 176;
  const label = "#b9d3c8";
  const brass = darker(palette.accent2, 0.4);
  const totalsX = W - M - 220;
  const metaWidth = INNER / 4;
  return design(t("studio.templates.items.invoice"), paletteList(palette), [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, head, gradient(160, [palette.accent, darker(palette.accent, 0.4)])),
      art("topographic", { primary: "#ffffff", secondary: palette.accent2 }, 0, 0, W, head, { opacity: 0.12 }),
      box("rect", 0, head, W, 3, foil("bronze", 0)),
      ...monogram(t, M, 40, 40, palette.accent2, palette.ink, FONTS.montserrat),
      text(M + 54, 40, 220, 22, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(M + 54, 62, 220, 14, t("studio.tpl.companyTagline"), { font: FONTS.inter, size: 8, color: label, spacing: 1.2, upper: true, shrink: true }),
      text(W - M - 240, 36, 240, 48, t("studio.tpl.invoice"), { font: FONTS.montserrat, size: 34, bold: true, color: "#ffffff", align: "right", valign: "middle", upper: true, spacing: 4, shrink: true }),
      rule(M, 106, INNER, "#2f6b58", 0.8),
      ...field(M, 120, metaWidth - 12, t("studio.tpl.invoiceNumber"), "INV-{n}", label, "#ffffff", FONTS.inter),
      ...field(M + metaWidth, 120, metaWidth - 12, t("studio.tpl.issueDate"), "{date}", label, "#ffffff", FONTS.inter),
      ...field(M + metaWidth * 2, 120, metaWidth - 12, t("studio.tpl.dueDate"), t("studio.tpl.dueDateValue"), label, "#ffffff", FONTS.inter),
      ...party(t, M, 208, "studio.tpl.billTo", brass, palette.ink, palette.muted, FONTS.montserrat, FONTS.inter, 240),
      shadowed(box("rect", W - M - 200, 204, 200, 82, solid(palette.soft), { radius: 12 }), "soft"),
      box("rect", W - M - 200, 216, 3, 58, solid(palette.accent2), { radius: 1.5 }),
      text(W - M - 184, 218, 168, 14, t("studio.tpl.total"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.accent, spacing: 1.8, upper: true, shrink: true }),
      text(W - M - 184, 236, 168, 38, t("studio.tpl.price"), { font: FONTS.montserrat, size: 26, bold: true, color: palette.ink, valign: "middle", shrink: true }),
      ...table(M, 312, [INNER - 250, 60, 90, 100], itemHeader(t), itemRows(t, 5), 30, { font: FONTS.inter, size: 9.5, ink: "#1f2a27", head: palette.accent, headInk: "#ffffff", line: "#e3e8e5", band: true, zebra: "#f6f8f6", strong: 3, aligns: ["left", "center", "right", "right"] }),
      ...pairs(totalsX, 508, 220, [[t("studio.tpl.subtotal"), t("studio.tpl.price")], [t("studio.tpl.tax"), t("studio.tpl.price")]], palette.muted, palette.ink, FONTS.inter),
      shadowed(box("rect", totalsX, 556, 220, 36, solid(palette.accent), { radius: 8 }), "soft"),
      text(totalsX + 14, 556, 100, 36, t("studio.tpl.total"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      text(totalsX + 104, 556, 102, 36, t("studio.tpl.price"), { font: FONTS.montserrat, size: 14, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
      text(M, 508, 220, 14, t("studio.tpl.paymentInfo"), { font: FONTS.inter, size: 7.5, bold: true, color: brass, spacing: 1.8, upper: true, shrink: true }),
      text(M, 528, 220, 60, t("studio.tpl.bankDetails"), { font: FONTS.inter, size: 9.5, color: "#3c4a46", lineHeight: 1.5, shrink: true }),
      rule(M, 632, INNER, "#e3e8e5", 0.8),
      text(M, 648, INNER, 36, t("studio.tpl.invoiceThanks"), { font: FONTS.inter, size: 10, italic: true, color: palette.muted, lineHeight: 1.45, shrink: true }),
      box("rect", 0, H - 74, W, 74, solid(palette.paper)),
      box("rect", M, H - 74, 40, 2, solid(palette.accent2)),
      ...contactRow(t, H - 48, palette.muted, FONTS.inter),
    ]),
  ]);
}

function quote({ t }: TemplateContext) {
  const palette = PALETTES.plumChampagne;
  const champagne = darker(palette.accent2, 0.45);
  const totalsX = W - M - 220;
  return design(t("studio.templates.items.quote"), paletteList(palette), [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, 8, H, gradient(180, [palette.accent, darker(palette.accent, 0.35)])),
      text(M, 48, 280, 60, t("studio.tpl.quote"), { font: FONTS.playfair, size: 46, bold: true, color: palette.accent, valign: "middle", shrink: true }),
      box("rect", M, 116, 64, 3, foil("gold", 0)),
      text(M, 128, 280, 18, t("studio.tpl.companyTagline"), { font: FONTS.playfair, size: 11, italic: true, color: palette.muted, shrink: true }),
      ...monogram(t, W - M - 40, 52, 40, palette.accent, "#ffffff", FONTS.playfair),
      text(W - M - 260, 54, 206, 20, t("studio.tpl.companyName"), { font: FONTS.playfair, size: 14, bold: true, color: palette.ink, align: "right", valign: "middle", shrink: true }),
      text(W - M - 260, 76, 206, 14, t("studio.tpl.website"), { font: FONTS.inter, size: 8, color: palette.muted, align: "right", spacing: 0.5, shrink: true }),
      box("rect", M, 168, INNER, 100, solid(palette.soft), { radius: 14 }),
      ...party(t, M + 20, 184, "studio.tpl.preparedFor", palette.accent, palette.ink, palette.muted, FONTS.playfair, FONTS.inter, 220),
      vrule(M + 262, 186, 64, lighter(palette.muted, 0.55), 0.8),
      ...field(M + 284, 186, 84, t("studio.tpl.quoteNumber"), "Q-{n}", palette.accent, palette.ink, FONTS.inter, 10.5),
      ...field(M + 380, 186, 84, t("studio.tpl.issueDate"), "{date}", palette.accent, palette.ink, FONTS.inter, 10.5),
      text(M + 284, 230, 180, 18, t("studio.tpl.validUntil"), { font: FONTS.playfair, size: 10.5, italic: true, color: palette.muted, valign: "middle", shrink: true }),
      ...table(M, 300, [INNER - 250, 60, 90, 100], itemHeader(t), itemRows(t, 5), 32, { font: FONTS.inter, size: 9.5, ink: palette.ink, head: palette.accent, headInk: palette.muted, line: "#ebe3e8", band: false, strong: 3, aligns: ["left", "center", "right", "right"] }),
      ...pairs(totalsX, 500, 220, [[t("studio.tpl.subtotal"), t("studio.tpl.price")], [t("studio.tpl.tax"), t("studio.tpl.price")]], palette.muted, palette.ink, FONTS.inter),
      box("rect", totalsX, 548, 220, 38, gradient(120, [palette.accent, darker(palette.accent, 0.3)]), { radius: 8 }),
      text(totalsX + 14, 548, 100, 38, t("studio.tpl.total"), { font: FONTS.inter, size: 10, bold: true, color: "#ffffff", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      text(totalsX + 104, 548, 102, 38, t("studio.tpl.price"), { font: FONTS.playfair, size: 16, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
      text(M, 500, 220, 14, t("studio.tpl.terms"), { font: FONTS.inter, size: 7.5, bold: true, color: champagne, spacing: 1.8, upper: true, shrink: true }),
      text(M, 520, 220, 72, t("studio.tpl.termsBody"), { font: FONTS.inter, size: 9.5, color: "#4a3d4d", lineHeight: 1.5, shrink: true }),
      rule(M, 680, 200, palette.muted, 0.8),
      text(M, 688, 200, 16, t("studio.tpl.acceptedBy"), { font: FONTS.inter, size: 8.5, color: palette.muted, spacing: 0.5, shrink: true }),
      rule(W - M - 200, 680, 200, palette.muted, 0.8),
      text(W - M - 200, 688, 200, 16, t("studio.tpl.date"), { font: FONTS.inter, size: 8.5, color: palette.muted, spacing: 0.5, align: "right", shrink: true }),
      rule(M, H - 66, INNER, "#ebe3e8", 0.8),
      ...contactRow(t, H - 54, palette.muted, FONTS.inter),
      box("rect", 8, H - 8, W - 8, 8, foil("gold", 0)),
    ]),
  ]);
}

function receipt({ t }: TemplateContext) {
  const page = RECEIPT;
  const palette = PALETTES.charcoalCoral;
  const ink = palette.ink;
  const muted = palette.muted;
  const pad = 16;
  const inner = page.width - pad * 2;
  const rows = [0, 1, 2, 3];
  return design(t("studio.templates.items.receipt"), [ink, palette.accent2, muted, "#ffffff"], [
    pageOf(page, solid("#ffffff"), [
      box("rect", 0, 0, page.width, 5, solid(palette.accent2)),
      shadowed(box("ellipse", page.width / 2 - 19, 20, 38, 38, solid(ink)), "soft"),
      text(page.width / 2 - 19, 20, 38, 38, initial(t), { font: FONTS.montserrat, size: 17, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
      text(pad, 64, inner, 20, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 12.5, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
      text(pad, 86, inner, 24, t("studio.tpl.address"), { font: FONTS.inter, size: 7.5, color: muted, align: "center", lineHeight: 1.3, shrink: true }),
      rule(pad, 120, inner, "#9aa0a6", 0.8, "dashed"),
      rule(pad, 138, 34, palette.accent2, 1.2),
      rule(page.width - pad - 34, 138, 34, palette.accent2, 1.2),
      text(pad + 40, 128, inner - 80, 20, t("studio.tpl.receipt"), { font: FONTS.montserrat, size: 10, bold: true, color: ink, align: "center", valign: "middle", upper: true, spacing: 3, shrink: true }),
      text(pad, 154, inner / 2, 14, "#{n}", { font: FONTS.inter, size: 8, color: muted }),
      text(pad + inner / 2, 154, inner / 2, 14, "{date}", { font: FONTS.inter, size: 8, color: muted, align: "right" }),
      ...rows.flatMap((index) => [
        text(pad, 180 + index * 22, inner - 72, 16, t("studio.tpl.itemName"), { font: FONTS.inter, size: 8.5, color: ink, valign: "middle", shrink: true }),
        text(page.width - pad - 66, 180 + index * 22, 66, 16, t("studio.tpl.price"), { font: FONTS.inter, size: 8.5, bold: true, color: ink, align: "right", valign: "middle", shrink: true }),
      ]),
      rule(pad, 274, inner, "#9aa0a6", 0.8, "dashed"),
      text(pad, 282, inner - 72, 14, t("studio.tpl.subtotal"), { font: FONTS.inter, size: 8, color: muted, valign: "middle", shrink: true }),
      text(page.width - pad - 66, 282, 66, 14, t("studio.tpl.price"), { font: FONTS.inter, size: 8, color: muted, align: "right", valign: "middle", shrink: true }),
      text(pad, 298, inner - 72, 14, t("studio.tpl.tax"), { font: FONTS.inter, size: 8, color: muted, valign: "middle", shrink: true }),
      text(page.width - pad - 66, 298, 66, 14, t("studio.tpl.price"), { font: FONTS.inter, size: 8, color: muted, align: "right", valign: "middle", shrink: true }),
      box("rect", pad - 4, 320, inner + 8, 30, solid(ink), { radius: 6 }),
      text(pad + 6, 320, inner / 2 - 6, 30, t("studio.tpl.total"), { font: FONTS.montserrat, size: 10, bold: true, color: "#ffffff", valign: "middle", upper: true, spacing: 1.5, shrink: true }),
      text(pad + inner / 2, 320, inner / 2 - 6, 30, t("studio.tpl.price"), { font: FONTS.montserrat, size: 12.5, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
      text(pad, 356, inner, 14, t("studio.tpl.paidBy"), { font: FONTS.inter, size: 7.5, color: muted, align: "center", shrink: true }),
      qr("https://example.com/receipt", page.width / 2 - 30, 376, 60, ink),
      text(pad, 440, inner, 14, t("studio.tpl.receiptThanks"), { font: FONTS.montserrat, size: 8.5, bold: true, color: ink, align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

function priceList({ t }: TemplateContext) {
  const palette = PALETTES.blushRose;
  const rose = darker(palette.accent, 0.12);
  const cardY = 212;
  const rowY = cardY + 58;
  const step = 36;
  const nameWidth = INNER - 230;
  const sprig = { primary: palette.accent, secondary: palette.accent2 };
  return design(t("studio.templates.items.priceList"), paletteList(palette), [
    pageOf(A4, radial(palette.paper, palette.soft, { cy: 0.15, radius: 1.1 }), [
      art("botanicalSprig", sprig, -10, 18, 90, 180, { rotation: -28, opacity: 0.45 }),
      art("botanicalSprig", sprig, W - 80, 18, 90, 180, { rotation: 28, opacity: 0.45 }),
      text(M, 52, INNER, 16, t("studio.tpl.companyName"), { font: FONTS.inter, size: 9, bold: true, color: rose, align: "center", spacing: 4, upper: true, shrink: true }),
      text(M + 40, 76, INNER - 80, 62, t("studio.tpl.priceList"), { font: FONTS.playfair, size: 46, bold: true, color: palette.ink, align: "center", valign: "middle", shrink: true }),
      art("diamondDivider", { primary: palette.accent2, secondary: palette.accent }, W / 2 - 90, 146, 180, 12),
      text(M + 40, 166, INNER - 80, 20, t("studio.tpl.priceListLead"), { font: FONTS.playfair, size: 13, italic: true, color: palette.muted, align: "center", shrink: true }),
      shadowed(box("rect", M, cardY, INNER, 500, solid("#ffffff"), { radius: 18 }), "lifted", palette.accent),
      text(M + 28, cardY + 22, nameWidth, 16, t("studio.tpl.service"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.8, upper: true, shrink: true }),
      text(M + 28 + nameWidth, cardY + 22, 100, 16, t("studio.tpl.duration"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.8, upper: true, align: "center", shrink: true }),
      text(W - M - 128, cardY + 22, 100, 16, t("studio.tpl.unitPrice"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.8, upper: true, align: "right", shrink: true }),
      rule(M + 28, cardY + 46, INNER - 56, palette.accent2, 1),
      ...Array.from({ length: 12 }, (_, index) => {
        const top = rowY + index * step;
        return [
          text(M + 28, top, nameWidth - 12, step, t("studio.tpl.serviceName"), { font: FONTS.playfair, size: 13, color: palette.ink, valign: "middle", shrink: true }),
          text(M + 28 + nameWidth, top, 100, step, t("studio.tpl.durationValue"), { font: FONTS.inter, size: 9, color: palette.muted, align: "center", valign: "middle", shrink: true }),
          text(W - M - 128, top, 100, step, t("studio.tpl.price"), { font: FONTS.inter, size: 11, bold: true, color: rose, align: "right", valign: "middle", shrink: true }),
          ...(index < 11 ? [rule(M + 28, top + step, INNER - 56, "#f0dcd9", 0.8, "dotted")] : []),
        ];
      }).flat(),
      text(M + 20, 730, INNER - 40, 30, t("studio.tpl.pricesNote"), { font: FONTS.playfair, size: 10.5, italic: true, color: palette.muted, align: "center", valign: "middle", shrink: true }),
      rule(W / 2 - 24, 774, 48, palette.accent2, 1),
      text(M, 786, INNER, 26, `${t("studio.tpl.address")}  ·  ${t("studio.tpl.phone")}  ·  ${t("studio.tpl.website")}`, { font: FONTS.inter, size: 8.5, color: palette.muted, align: "center", valign: "middle", shrink: true }),
    ]),
  ]);
}

function reportCover({ t }: TemplateContext) {
  const navy = "#0b2545";
  const deep = "#071a33";
  const teal = "#13c4a3";
  const photoHeight = 440;
  return design(t("studio.templates.items.reportCover"), [navy, teal, "#ffffff"], [
    pageOf(A4, solid(navy), [
      ...photoSlot(0, 0, W, photoHeight, "#16325c"),
      box("rect", 0, photoHeight, W, H - photoHeight, gradient(180, [navy, deep])),
      art("topographic", { primary: teal, secondary: "#ffffff" }, 0, photoHeight, W, H - photoHeight, { opacity: 0.1 }),
      box("rect", 0, photoHeight - 3, W, 3, solid(teal)),
      shadowed(box("rect", M, photoHeight - 30, 116, 56, solid(teal), { radius: 4 }), "lifted"),
      text(M, photoHeight - 30, 116, 56, "2027", { font: FONTS.montserrat, size: 26, bold: true, color: navy, align: "center", valign: "middle", spacing: 1 }),
      text(M, 494, INNER, 132, t("studio.tpl.reportTitle"), { font: FONTS.montserrat, size: 48, bold: true, color: "#ffffff", lineHeight: 1.04, valign: "middle", shrink: true }),
      box("rect", M, 642, 56, 3, solid(teal)),
      text(M, 658, INNER - 80, 48, t("studio.tpl.reportSubtitle"), { font: FONTS.inter, size: 14, color: "#c7d3e3", lineHeight: 1.45, shrink: true }),
      art("cornerTriangles", { primary: teal, secondary: "#ffffff" }, W - 150, H - 150, 150, 150, { rotation: 180, opacity: 0.9 }),
      rule(M, H - 104, INNER - 160, "#24426b", 0.8),
      text(M, H - 92, 300, 20, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 13, bold: true, color: "#ffffff", valign: "middle", shrink: true }),
      text(M, H - 70, 300, 16, t("studio.tpl.preparedBy"), { font: FONTS.inter, size: 9.5, color: "#9fb2cc", shrink: true }),
    ]),
  ]);
}

function proposalCover({ t }: TemplateContext) {
  const palette = PALETTES.terracotta;
  const column = 212;
  const left = W - column;
  const textWidth = left - M - 44;
  const label = darker(palette.accent, 0.25);
  return design(t("studio.templates.items.proposalCover"), paletteList(palette), [
    pageOf(A4, solid(palette.paper), [
      box("rect", left, 0, column, H, gradient(170, [palette.ink, darker(palette.ink, 0.35)])),
      art("diagonalHatch", { primary: palette.accent2, secondary: palette.accent }, left, 0, column, H, { opacity: 0.08 }),
      ...photoSlot(left, 236, column, 400, "#5a4034"),
      art("arcRings", { primary: palette.accent, secondary: palette.accent2 }, left - 96, 48, 200, 200, { opacity: 0.9 }),
      text(M, 96, textWidth - 40, 18, t("studio.tpl.companyName"), { font: FONTS.inter, size: 10, bold: true, color: label, spacing: 3, upper: true, shrink: true }),
      box("rect", M, 122, 24, 2, solid(palette.accent)),
      text(M, 336, textWidth, 28, t("studio.tpl.proposal"), { font: FONTS.inter, size: 15, color: palette.muted, spacing: 6, upper: true, valign: "middle", shrink: true }),
      text(M, 372, textWidth, 176, t("studio.tpl.proposalTitle"), { font: FONTS.playfair, size: 44, bold: true, color: palette.ink, lineHeight: 1.08, shrink: true }),
      box("rect", M, 564, 72, 4, foil("copper", 0)),
      ...party(t, M, 600, "studio.tpl.preparedFor", label, palette.ink, palette.muted, FONTS.playfair, FONTS.inter, textWidth),
      ...field(M, 700, textWidth, t("studio.tpl.date"), "{date}", label, palette.ink, FONTS.inter, 11),
      text(M, H - 64, textWidth, 16, t("studio.tpl.website"), { font: FONTS.inter, size: 8.5, color: palette.muted, spacing: 1, shrink: true }),
      text(left + 24, H - 64, column - 48, 16, t("studio.tpl.email"), { font: FONTS.inter, size: 8.5, color: "#e9d8cc", align: "right", shrink: true }),
    ]),
  ]);
}

function agenda({ t }: TemplateContext) {
  const palette = PALETTES.cobaltSun;
  const times = ["09:00", "09:15", "09:45", "10:30", "11:00", "11:30", "12:00"];
  const cardWidth = (INNER - 24) / 3;
  const top = 314;
  const step = 42;
  const axis = M + 74;
  const metas: [string, string][] = [
    ["studio.tpl.date", "{date}"],
    ["studio.tpl.location", t("studio.tpl.meetingRoom")],
    ["studio.tpl.facilitator", t("studio.tpl.personName")],
  ];
  return design(t("studio.templates.items.meetingAgenda"), paletteList(palette), [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, 196, gradient(160, [palette.soft, "#f4f6fd"])),
      art("halftone", { primary: palette.accent, secondary: palette.accent2 }, W - 220, 0, 220, 196, { opacity: 0.18 }),
      ...monogram(t, M, 40, 34, palette.accent, "#ffffff", FONTS.montserrat),
      ...brand(t, M + 46, 38, palette.ink, palette.muted, FONTS.montserrat, FONTS.inter),
      text(M, 92, INNER - 120, 46, t("studio.tpl.meetingAgenda"), { font: FONTS.montserrat, size: 32, bold: true, color: palette.ink, valign: "middle", shrink: true }),
      box("rect", M, 144, 44, 4, solid(palette.accent2), { radius: 2 }),
      ...metas.flatMap(([label, value], index) => {
        const x = M + index * (cardWidth + 12);
        return [shadowed(box("rect", x, 168, cardWidth, 58, solid("#ffffff"), { radius: 10, stroke: stroke("#dbe3f6", 0.8) }), "soft"), ...field(x + 14, 178, cardWidth - 28, t(label), value, palette.accent, palette.ink, FONTS.inter, 11)];
      }),
      text(M, 248, 120, 14, t("studio.tpl.attendees"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.accent, spacing: 1.8, upper: true, shrink: true }),
      text(M + 120, 244, INNER - 120, 22, t("studio.tpl.attendeeList"), { font: FONTS.inter, size: 9.5, color: palette.muted, valign: "middle", shrink: true }),
      rule(M, 282, INNER, "#e3e8f4", 0.8),
      text(M, 294, 58, 14, t("studio.tpl.time"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.5, upper: true, align: "right", shrink: true }),
      text(axis + 22, 294, 200, 14, t("studio.tpl.topic"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.5, upper: true, shrink: true }),
      text(W - M - 150, 294, 150, 14, t("studio.tpl.owner"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.muted, spacing: 1.5, upper: true, align: "right", shrink: true }),
      vrule(axis, top + step / 2, step * (times.length - 1), "#c9d5f3", 1.4),
      ...times.flatMap((time, index) => {
        const y = top + index * step;
        return [
          text(M, y, 58, step, time, { font: FONTS.montserrat, size: 11, bold: true, color: palette.accent, align: "right", valign: "middle" }),
          box("ellipse", axis - 6, y + step / 2 - 6, 12, 12, solid(index === 0 ? palette.accent2 : palette.accent), { stroke: stroke("#ffffff", 2) }),
          text(axis + 22, y, INNER - 74 - 22 - 160, step, t("studio.tpl.topicName"), { font: FONTS.inter, size: 11.5, bold: true, color: palette.ink, valign: "middle", shrink: true }),
          text(W - M - 150, y, 150, step, t("studio.tpl.personName"), { font: FONTS.inter, size: 9.5, color: palette.muted, align: "right", valign: "middle", shrink: true }),
          ...(index < times.length - 1 ? [rule(axis + 22, y + step, W - M - axis - 22, "#edf0f7", 0.8)] : []),
        ];
      }),
      text(M, 626, INNER, 14, t("studio.tpl.notes"), { font: FONTS.inter, size: 7.5, bold: true, color: palette.accent, spacing: 1.8, upper: true, shrink: true }),
      ...[0, 1, 2, 3].map((index) => rule(M, 668 + index * 28, INNER, "#d7deec", 0.6)),
      box("rect", 0, H - 6, W, 6, gradient(0, [palette.accent, palette.accent2])),
      ...contactRow(t, H - 44, palette.muted, FONTS.inter),
    ]),
  ]);
}

export const BUSINESS_TEMPLATES: StudioTemplate[] = [
  { id: "letterhead", category: "business", size: A4, build: letterhead },
  { id: "invoice", category: "business", size: A4, build: invoice },
  { id: "quote", category: "business", size: A4, build: quote },
  { id: "receipt", category: "business", size: RECEIPT, build: receipt },
  { id: "priceList", category: "business", size: A4, build: priceList },
  { id: "reportCover", category: "covers", size: A4, build: reportCover },
  { id: "proposalCover", category: "covers", size: A4, build: proposalCover },
  { id: "meetingAgenda", category: "business", size: A4, build: agenda },
];
