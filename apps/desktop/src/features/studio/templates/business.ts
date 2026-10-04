import type { StudioElement } from "@/types/studio";
import { art, box, design, FONTS, grid, linear, pageOf, photoSlot, qr, rule, sizeOf, solid, text, type StudioTemplate, type TemplateContext } from "./kit";

const A4 = "a4" as const;
const { width: W, height: H } = sizeOf(A4);
const M = 48;
const RECEIPT = { width: 226.77, height: 460 };
const INNER = W - M * 2;

function brand(t: TemplateContext["t"], accent: string, ink: string): StudioElement[] {
  return [
    box("rect", M, 46, 34, 34, solid(accent), { radius: 8 }),
    text(M, 46, 34, 34, "V", { font: FONTS.montserrat, size: 18, bold: true, color: "#ffffff", align: "center", valign: "middle" }),
    text(M + 46, 46, 260, 20, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 14, bold: true, color: ink, shrink: true }),
    text(M + 46, 66, 260, 16, t("studio.tpl.companyTagline"), { font: FONTS.inter, size: 9, color: "#6b7280", shrink: true }),
  ];
}

function companyFooter(t: TemplateContext["t"], accent: string): StudioElement[] {
  const keys = ["studio.tpl.address", "studio.tpl.phone", "studio.tpl.email", "studio.tpl.website"];
  const column = INNER / keys.length;
  return [
    rule(M, H - 66, INNER, accent, 1),
    ...keys.map((key, index) => text(M + index * column, H - 56, column - 8, 28, t(key), { font: FONTS.inter, size: 8, color: "#6b7280", lineHeight: 1.3, shrink: true })),
  ];
}

function party(t: TemplateContext["t"], x: number, y: number, labelKey: string, accent: string): StudioElement[] {
  return [
    text(x, y, 220, 14, t(labelKey), { font: FONTS.inter, size: 8, bold: true, color: accent, spacing: 1.5, upper: true }),
    text(x, y + 18, 220, 18, t("studio.tpl.clientName"), { font: FONTS.inter, size: 12, bold: true, color: "#111827", shrink: true }),
    text(x, y + 38, 220, 36, t("studio.tpl.address"), { font: FONTS.inter, size: 9.5, color: "#4b5563", lineHeight: 1.35, shrink: true }),
  ];
}

function meta(t: TemplateContext["t"], x: number, y: number, rows: [string, string][], accent: string): StudioElement[] {
  return rows.flatMap(([label, value], index) => [
    text(x, y + index * 18, 110, 16, t(label), { font: FONTS.inter, size: 9, color: "#6b7280", shrink: true }),
    text(x + 110, y + index * 18, 110, 16, value, { font: FONTS.inter, size: 9, bold: true, color: index === 0 ? accent : "#111827", align: "right", shrink: true }),
  ]);
}

function lineItems(t: TemplateContext["t"], y: number, accent: string, rows = 5): StudioElement[] {
  const columns = [INNER - 250, 60, 90, 100];
  const header = [t("studio.tpl.description"), t("studio.tpl.quantity"), t("studio.tpl.unitPrice"), t("studio.tpl.amount")];
  const body = Array.from({ length: rows }, () => [t("studio.tpl.itemName"), "1", t("studio.tpl.price"), t("studio.tpl.price")]);
  return grid(M, y, columns, 26, [header, ...body], { font: FONTS.inter, size: 9.5, headerFill: accent, zebra: "#f9fafb", aligns: ["left", "center", "right", "right"] });
}

function totals(t: TemplateContext["t"], y: number, accent: string): StudioElement[] {
  const x = W - M - 220;
  return [
    ...meta(t, x, y, [["studio.tpl.subtotal", t("studio.tpl.price")], ["studio.tpl.tax", t("studio.tpl.price")]], "#111827"),
    box("rect", x, y + 42, 220, 30, solid(accent), { radius: 6 }),
    text(x + 10, y + 42, 100, 30, t("studio.tpl.total"), { font: FONTS.inter, size: 11, bold: true, color: "#ffffff", valign: "middle", upper: true, spacing: 1 }),
    text(x + 110, y + 42, 100, 30, t("studio.tpl.price"), { font: FONTS.inter, size: 12, bold: true, color: "#ffffff", align: "right", valign: "middle", shrink: true }),
  ];
}

function letterhead({ t }: TemplateContext) {
  const accent = "#1d4ed8";
  const ink = "#0f172a";
  return design(t("studio.templates.items.letterhead"), [accent, ink], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, 10, H, linear(180, accent, "#60a5fa")),
      ...brand(t, accent, ink),
      text(W - M - 200, 50, 200, 40, t("studio.tpl.letterDate"), { font: FONTS.inter, size: 10, color: "#6b7280", align: "right", shrink: true }),
      rule(M, 104, INNER, "#e5e7eb", 1),
      ...party(t, M, 128, "studio.tpl.to", accent),
      text(M, 222, INNER, 22, t("studio.tpl.letterSubject"), { font: FONTS.inter, size: 12, bold: true, color: ink, shrink: true }),
      text(M, 256, INNER, 420, t("studio.tpl.letterBody"), { font: FONTS.sourceSerif, size: 11.5, color: "#1f2937", lineHeight: 1.6 }),
      text(M, 670, 240, 18, t("studio.tpl.regards"), { font: FONTS.sourceSerif, size: 11.5, color: "#1f2937" }),
      text(M, 694, 240, 30, t("studio.tpl.personName"), { font: FONTS.dancing, size: 20, color: accent, shrink: true }),
      text(M, 724, 240, 16, t("studio.tpl.jobTitle"), { font: FONTS.inter, size: 9.5, color: "#6b7280", shrink: true }),
      ...companyFooter(t, accent),
    ]),
  ]);
}

function invoice({ t }: TemplateContext) {
  const accent = "#0f766e";
  const ink = "#111827";
  return design(t("studio.templates.items.invoice"), [accent, ink], [
    pageOf(A4, solid("#ffffff"), [
      ...brand(t, accent, ink),
      text(W - M - 220, 40, 220, 44, t("studio.tpl.invoice"), { font: FONTS.montserrat, size: 32, bold: true, color: ink, align: "right", upper: true, spacing: 2, shrink: true }),
      ...meta(t, W - M - 220, 104, [["studio.tpl.invoiceNumber", "INV-{n}"], ["studio.tpl.issueDate", "{date}"], ["studio.tpl.dueDate", t("studio.tpl.dueDateValue")]], accent),
      ...party(t, M, 110, "studio.tpl.billTo", accent),
      ...lineItems(t, 200, accent),
      ...totals(t, 380, accent),
      text(M, 380, 260, 14, t("studio.tpl.paymentInfo"), { font: FONTS.inter, size: 8, bold: true, color: accent, spacing: 1.5, upper: true }),
      text(M, 398, 260, 56, t("studio.tpl.bankDetails"), { font: FONTS.inter, size: 9.5, color: "#374151", lineHeight: 1.45, shrink: true }),
      text(M, 500, INNER, 40, t("studio.tpl.invoiceThanks"), { font: FONTS.inter, size: 10, italic: true, color: "#6b7280", lineHeight: 1.4, shrink: true }),
      ...companyFooter(t, accent),
    ]),
  ]);
}

function quote({ t }: TemplateContext) {
  const accent = "#7c3aed";
  const ink = "#1e1b4b";
  return design(t("studio.templates.items.quote"), [accent, ink], [
    pageOf(A4, solid("#ffffff"), [
      box("rect", 0, 0, W, 130, linear(135, ink, accent)),
      art("arcRings", { primary: "#ffffff", secondary: "#c4b5fd" }, W - 150, -40, 180, 180, { opacity: 0.25 }),
      text(M, 40, 300, 46, t("studio.tpl.quote"), { font: FONTS.montserrat, size: 34, bold: true, color: "#ffffff", upper: true, spacing: 2, shrink: true }),
      text(M, 88, 300, 18, t("studio.tpl.companyName"), { font: FONTS.inter, size: 11, color: "#ddd6fe", shrink: true }),
      ...party(t, M, 156, "studio.tpl.preparedFor", accent),
      ...meta(t, W - M - 220, 160, [["studio.tpl.quoteNumber", "Q-{n}"], ["studio.tpl.issueDate", "{date}"], ["studio.tpl.validUntil", t("studio.tpl.dueDateValue")]], accent),
      ...lineItems(t, 250, accent),
      ...totals(t, 430, accent),
      text(M, 430, 260, 14, t("studio.tpl.terms"), { font: FONTS.inter, size: 8, bold: true, color: accent, spacing: 1.5, upper: true }),
      text(M, 448, 260, 80, t("studio.tpl.termsBody"), { font: FONTS.inter, size: 9.5, color: "#374151", lineHeight: 1.45, shrink: true }),
      rule(M, 640, 200, "#9ca3af", 0.8),
      text(M, 646, 200, 16, t("studio.tpl.acceptedBy"), { font: FONTS.inter, size: 9, color: "#6b7280" }),
      rule(W - M - 200, 640, 200, "#9ca3af", 0.8),
      text(W - M - 200, 646, 200, 16, t("studio.tpl.date"), { font: FONTS.inter, size: 9, color: "#6b7280" }),
      ...companyFooter(t, accent),
    ]),
  ]);
}

function receipt({ t }: TemplateContext) {
  const page = RECEIPT;
  const ink = "#111827";
  const rows = ["1", "2", "3", "4"];
  return design(t("studio.templates.items.receipt"), [ink, "#6b7280"], [
    pageOf(page, solid("#ffffff"), [
      text(16, 24, page.width - 32, 22, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 13, bold: true, color: ink, align: "center", shrink: true }),
      text(16, 46, page.width - 32, 28, t("studio.tpl.address"), { font: FONTS.inter, size: 7.5, color: "#4b5563", align: "center", lineHeight: 1.3, shrink: true }),
      rule(16, 84, page.width - 32, ink, 0.8, "dashed"),
      text(16, 92, page.width - 32, 18, t("studio.tpl.receipt"), { font: FONTS.montserrat, size: 11, bold: true, color: ink, align: "center", upper: true, spacing: 3 }),
      text(16, 112, page.width / 2 - 16, 14, "#{n}", { font: FONTS.inter, size: 8, color: "#4b5563" }),
      text(page.width / 2, 112, page.width / 2 - 16, 14, "{date}", { font: FONTS.inter, size: 8, color: "#4b5563", align: "right" }),
      ...rows.flatMap((_, index) => [
        text(16, 140 + index * 22, 130, 16, t("studio.tpl.itemName"), { font: FONTS.inter, size: 8.5, color: ink, shrink: true }),
        text(page.width - 86, 140 + index * 22, 70, 16, t("studio.tpl.price"), { font: FONTS.inter, size: 8.5, color: ink, align: "right", shrink: true }),
      ]),
      rule(16, 236, page.width - 32, ink, 0.8, "dashed"),
      text(16, 246, 100, 20, t("studio.tpl.total"), { font: FONTS.montserrat, size: 11, bold: true, color: ink, upper: true, valign: "middle" }),
      text(page.width - 116, 246, 100, 20, t("studio.tpl.price"), { font: FONTS.montserrat, size: 12, bold: true, color: ink, align: "right", valign: "middle", shrink: true }),
      text(16, 272, page.width - 32, 14, t("studio.tpl.paidBy"), { font: FONTS.inter, size: 8, color: "#4b5563", shrink: true }),
      rule(16, 296, page.width - 32, ink, 0.8, "dashed"),
      qr("https://example.com/receipt", page.width / 2 - 40, 312, 80, ink),
      text(16, 404, page.width - 32, 30, t("studio.tpl.receiptThanks"), { font: FONTS.inter, size: 9, bold: true, color: ink, align: "center", lineHeight: 1.3, shrink: true }),
    ]),
  ]);
}

function priceList({ t }: TemplateContext) {
  const accent = "#be123c";
  const ink = "#1f2937";
  const columns = [INNER - 200, 100, 100];
  const header = [t("studio.tpl.service"), t("studio.tpl.duration"), t("studio.tpl.unitPrice")];
  const body = Array.from({ length: 12 }, () => [t("studio.tpl.serviceName"), t("studio.tpl.durationValue"), t("studio.tpl.price")]);
  return design(t("studio.templates.items.priceList"), [accent, ink], [
    pageOf(A4, solid("#fffbfb"), [
      art("blob", { primary: "#fecdd3", secondary: "#ffe4e6" }, W - 230, -90, 320, 300, { opacity: 0.9 }),
      ...brand(t, accent, ink),
      text(M, 120, INNER, 56, t("studio.tpl.priceList"), { font: FONTS.playfair, size: 40, bold: true, color: ink, shrink: true }),
      text(M, 178, INNER, 20, t("studio.tpl.priceListLead"), { font: FONTS.inter, size: 11, color: "#6b7280", shrink: true }),
      ...grid(M, 220, columns, 32, [header, ...body], { font: FONTS.inter, size: 10.5, headerFill: accent, zebra: "#fff1f2", lineColor: "#fecdd3", aligns: ["left", "center", "right"] }),
      text(M, 660, INNER, 30, t("studio.tpl.pricesNote"), { font: FONTS.inter, size: 9.5, italic: true, color: "#6b7280", shrink: true }),
      ...companyFooter(t, accent),
    ]),
  ]);
}

function reportCover({ t }: TemplateContext) {
  const navy = "#0b2545";
  const teal = "#13c4a3";
  return design(t("studio.templates.items.reportCover"), [navy, teal], [
    pageOf(A4, solid(navy), [
      ...photoSlot(0, 0, W, 360, "#16325c"),
      box("rect", 0, 360, W, H - 360, solid(navy)),
      box("rect", M, 330, 120, 60, solid(teal)),
      text(M, 330, 120, 60, "2027", { font: FONTS.montserrat, size: 26, bold: true, color: navy, align: "center", valign: "middle" }),
      text(M, 420, INNER, 150, t("studio.tpl.reportTitle"), { font: FONTS.montserrat, size: 44, bold: true, color: "#ffffff", lineHeight: 1.05, shrink: true, valign: "middle" }),
      text(M, 580, INNER - 60, 50, t("studio.tpl.reportSubtitle"), { font: FONTS.inter, size: 15, color: "#cbd5e1", lineHeight: 1.4, shrink: true }),
      art("cornerTriangles", { primary: teal, secondary: "#ffffff" }, W - 160, H - 160, 160, 160, { rotation: 180 }),
      rule(M, H - 110, 60, teal, 3),
      text(M, H - 96, 300, 20, t("studio.tpl.companyName"), { font: FONTS.montserrat, size: 13, bold: true, color: "#ffffff", shrink: true }),
      text(M, H - 74, 300, 18, t("studio.tpl.preparedBy"), { font: FONTS.inter, size: 10, color: "#94a3b8", shrink: true }),
    ]),
  ]);
}

function proposalCover({ t }: TemplateContext) {
  const amber = "#d97706";
  const ink = "#1c1917";
  return design(t("studio.templates.items.proposalCover"), [amber, ink], [
    pageOf(A4, solid("#fafaf9"), [
      box("rect", W - 200, 0, 200, H, solid(ink)),
      art("arcRings", { primary: amber, secondary: "#fbbf24" }, W - 300, 120, 200, 200),
      ...photoSlot(W - 200, 460, 200, 260, "#44403c"),
      text(M, 120, W - 280, 20, t("studio.tpl.companyName"), { font: FONTS.raleway, size: 12, bold: true, color: amber, spacing: 3, upper: true, shrink: true }),
      text(M, 340, W - 280, 40, t("studio.tpl.proposal"), { font: FONTS.raleway, size: 20, color: "#57534e", spacing: 6, upper: true, shrink: true }),
      text(M, 384, W - 280, 160, t("studio.tpl.proposalTitle"), { font: FONTS.playfair, size: 42, bold: true, color: ink, lineHeight: 1.08, shrink: true }),
      box("rect", M, 560, 70, 5, solid(amber)),
      ...party(t, M, 600, "studio.tpl.preparedFor", amber),
      text(M, 700, 220, 14, t("studio.tpl.date"), { font: FONTS.inter, size: 8, bold: true, color: amber, spacing: 1.5, upper: true }),
      text(M, 718, 220, 18, "{date}", { font: FONTS.inter, size: 11, color: ink }),
    ]),
  ]);
}

function agenda({ t }: TemplateContext) {
  const accent = "#2563eb";
  const ink = "#0f172a";
  const columns = [70, INNER - 230, 160];
  const header = [t("studio.tpl.time"), t("studio.tpl.topic"), t("studio.tpl.owner")];
  const times = ["09:00", "09:15", "09:45", "10:30", "11:00", "11:30", "12:00"];
  const body = times.map((time) => [time, t("studio.tpl.topicName"), t("studio.tpl.personName")]);
  return design(t("studio.templates.items.meetingAgenda"), [accent, ink], [
    pageOf(A4, solid("#ffffff"), [
      ...brand(t, accent, ink),
      text(M, 112, INNER, 46, t("studio.tpl.meetingAgenda"), { font: FONTS.montserrat, size: 32, bold: true, color: ink, shrink: true }),
      ...meta(t, M, 168, [["studio.tpl.date", "{date}"], ["studio.tpl.location", t("studio.tpl.meetingRoom")], ["studio.tpl.facilitator", t("studio.tpl.personName")]], accent),
      text(M + 280, 168, INNER - 280, 14, t("studio.tpl.attendees"), { font: FONTS.inter, size: 8, bold: true, color: accent, spacing: 1.5, upper: true }),
      text(M + 280, 186, INNER - 280, 40, t("studio.tpl.attendeeList"), { font: FONTS.inter, size: 9.5, color: "#374151", lineHeight: 1.4, shrink: true }),
      ...grid(M, 250, columns, 36, [header, ...body], { font: FONTS.inter, size: 10.5, headerFill: accent, zebra: "#eff6ff", aligns: ["left", "left", "left"] }),
      text(M, 560, INNER, 14, t("studio.tpl.notes"), { font: FONTS.inter, size: 8, bold: true, color: accent, spacing: 1.5, upper: true }),
      ...[0, 1, 2, 3, 4].map((index) => rule(M, 600 + index * 28, INNER, "#d1d5db", 0.6)),
      ...companyFooter(t, accent),
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
