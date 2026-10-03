import type { TFunction } from "i18next";
import type { DocumentSettings, StudioDocument } from "@/types/studio";
import { createDocument } from "./model";
import { escapeHtml } from "./toHtml";

export const DOCUMENT_STARTERS = ["blank", "report", "letter", "petition", "assignment", "minutes", "lectureNotes", "booklet", "cv", "invoice"] as const;

export type DocumentStarter = (typeof DOCUMENT_STARTERS)[number];

type Builder = (text: (key: string) => string, today: string) => { html: string; settings?: Partial<DocumentSettings> };

const p = (value: string, align?: "center" | "right" | "justify") => `<p${align ? ` style="text-align:${align}"` : ""}>${value}</p>`;
const h = (level: number, value: string, align?: "center") => `<h${level}${align ? ` style="text-align:${align}"` : ""}>${value}</h${level}>`;
const list = (items: string[], ordered = false) => `<${ordered ? "ol" : "ul"}>${items.map((item) => `<li><p>${item}</p></li>`).join("")}</${ordered ? "ol" : "ul"}>`;
const tasks = (items: string[]) => `<ul data-type="taskList">${items.map((item) => `<li data-type="taskItem" data-checked="false"><p>${item}</p></li>`).join("")}</ul>`;
const table = (header: string[] | null, rows: string[][]) =>
  `<table>${header ? `<tr>${header.map((cell) => `<th><p>${cell}</p></th>`).join("")}</tr>` : ""}${rows.map((row) => `<tr>${row.map((cell) => `<td><p>${cell}</p></td>`).join("")}</tr>`).join("")}</table>`;
const strong = (value: string) => `<strong>${value}</strong>`;

const BUILDERS: Record<DocumentStarter, Builder> = {
  blank: () => ({ html: "" }),
  report: (s, today) => ({
    settings: { cover: true, toc: true, title: s("report.title"), subtitle: s("report.subtitle"), date: today, coverStyle: "band" },
    html: [
      h(1, s("report.summary")),
      p(s("common.paragraph"), "justify"),
      h(1, s("report.background")),
      p(s("common.paragraph"), "justify"),
      h(2, s("report.goals")),
      list([s("report.goal1"), s("report.goal2"), s("report.goal3")]),
      h(1, s("report.findings")),
      p(s("common.paragraphShort"), "justify"),
      table([s("report.item"), s("report.value"), s("report.note")], [
        [s("report.row1"), "42", s("report.noteGood")],
        [s("report.row2"), "17", s("report.noteWatch")],
      ]),
      h(1, s("report.conclusion")),
      p(s("common.paragraph"), "justify"),
    ].join(""),
  }),
  letter: (s, today) => ({
    settings: { pageNumbers: "none" },
    html: [
      p(`${strong(s("common.yourName"))}<br>${s("common.address")}<br>${s("common.contact")}`, "right"),
      p(today, "right"),
      p(`${s("letter.recipient")}<br>${s("letter.recipientAddress")}`),
      p(strong(`${s("letter.subjectLabel")}: ${s("letter.subject")}`)),
      p(s("letter.greeting")),
      p(s("common.paragraph"), "justify"),
      p(s("common.paragraphShort"), "justify"),
      p(s("letter.closing")),
      p(`<br>${s("common.yourName")}`),
    ].join(""),
  }),
  petition: (s, today) => ({
    settings: { pageNumbers: "none", marginMm: 25 },
    html: [
      h(3, s("petition.addressee"), "center"),
      p("&nbsp;"),
      p(s("petition.body"), "justify"),
      p(s("petition.request"), "justify"),
      p("&nbsp;"),
      p(`${today}<br>${s("common.yourName")}<br>${s("petition.signature")}`, "right"),
      p(`${strong(`${s("petition.addressLabel")}:`)} ${s("common.address")}`),
      p(strong(`${s("petition.attachments")}:`)),
      list([s("petition.attachment1")], true),
    ].join(""),
  }),
  assignment: (s, today) => ({
    html: [
      h(1, s("assignment.title"), "center"),
      p(`${s("common.yourName")}<br>${s("assignment.course")}<br>${today}`, "center"),
      h(2, s("assignment.introduction")),
      p(s("common.paragraph"), "justify"),
      h(2, s("assignment.method")),
      p(s("common.paragraphShort"), "justify"),
      h(2, s("assignment.results")),
      p(s("common.paragraph"), "justify"),
      h(2, s("assignment.conclusion")),
      p(s("common.paragraphShort"), "justify"),
      h(2, s("assignment.references")),
      list([s("assignment.reference1"), s("assignment.reference2")], true),
    ].join(""),
  }),
  minutes: (s, today) => ({
    html: [
      h(1, s("minutes.title"), "center"),
      table(null, [
        [strong(s("minutes.date")), today],
        [strong(s("minutes.place")), s("minutes.placeValue")],
        [strong(s("minutes.chair")), s("common.yourName")],
        [strong(s("minutes.attendees")), s("minutes.attendeesValue")],
      ]),
      h(2, s("minutes.agenda")),
      list([s("minutes.agenda1"), s("minutes.agenda2"), s("minutes.agenda3")], true),
      h(2, s("minutes.discussion")),
      p(s("common.paragraph"), "justify"),
      h(2, s("minutes.decisions")),
      list([s("minutes.decision1"), s("minutes.decision2")], true),
      h(2, s("minutes.actions")),
      tasks([s("minutes.action1"), s("minutes.action2")]),
      p("&nbsp;"),
      table([s("minutes.signatureName"), s("minutes.signature")], [["", ""], ["", ""]]),
    ].join(""),
  }),
  lectureNotes: (s, today) => ({
    settings: { fontSize: 10.5, marginMm: 16, header: s("lectureNotes.course"), headerAlign: "left" },
    html: [
      h(1, s("lectureNotes.topic")),
      p(`${strong(s("lectureNotes.course"))} · ${today}`),
      h(2, s("lectureNotes.keyIdeas")),
      list([s("lectureNotes.idea1"), s("lectureNotes.idea2"), s("lectureNotes.idea3")]),
      `<blockquote>${p(s("lectureNotes.remember"))}</blockquote>`,
      h(2, s("lectureNotes.details")),
      p(s("common.paragraph"), "justify"),
      h(2, s("lectureNotes.review")),
      tasks([s("lectureNotes.review1"), s("lectureNotes.review2")]),
    ].join(""),
  }),
  booklet: (s, today) => ({
    settings: { paper: "a5", marginMm: 15, fontSize: 10.5, cover: true, toc: true, coverStyle: "frame", title: s("booklet.title"), subtitle: s("booklet.subtitle"), date: today, pageNumbers: "outside" },
    html: [
      h(1, s("booklet.chapter1")),
      p(s("common.paragraph"), "justify"),
      h(2, s("booklet.section1")),
      p(s("common.paragraphShort"), "justify"),
      '<div data-page-break=""></div>',
      h(1, s("booklet.chapter2")),
      p(s("common.paragraph"), "justify"),
      h(2, s("booklet.section2")),
      p(s("common.paragraphShort"), "justify"),
    ].join(""),
  }),
  cv: (s) => ({
    settings: { pageNumbers: "none", marginMm: 18, accent: "#0f766e" },
    html: [
      h(1, s("common.yourName")),
      p(`${s("cv.role")} · ${s("common.contact")} · ${s("common.address")}`),
      "<hr>",
      h(2, s("cv.profile")),
      p(s("cv.profileText"), "justify"),
      h(2, s("cv.experience")),
      h(3, s("cv.job1")),
      p(s("cv.job1Dates")),
      list([s("cv.achievement1"), s("cv.achievement2")]),
      h(3, s("cv.job2")),
      p(s("cv.job2Dates")),
      list([s("cv.achievement3")]),
      h(2, s("cv.education")),
      p(`${strong(s("cv.school"))}<br>${s("cv.schoolDates")}`),
      h(2, s("cv.skills")),
      list([s("cv.skill1"), s("cv.skill2"), s("cv.skill3")]),
    ].join(""),
  }),
  invoice: (s, today) => ({
    settings: { pageNumbers: "none", accent: "#1e3a8a" },
    html: [
      h(1, s("invoice.title")),
      p(`${strong(s("invoice.company"))}<br>${s("common.address")}<br>${s("common.contact")}`),
      table(null, [
        [strong(s("invoice.number")), "2026-001"],
        [strong(s("invoice.date")), today],
        [strong(s("invoice.due")), s("invoice.dueValue")],
      ]),
      h(3, s("invoice.billTo")),
      p(`${s("letter.recipient")}<br>${s("letter.recipientAddress")}`),
      table([s("invoice.description"), s("invoice.quantity"), s("invoice.price"), s("invoice.amount")], [
        [s("invoice.item1"), "2", "150.00", "300.00"],
        [s("invoice.item2"), "1", "80.00", "80.00"],
      ]),
      p(`${s("invoice.subtotal")}: 380.00<br>${s("invoice.tax")}: 76.00<br>${strong(`${s("invoice.total")}: 456.00`)}`, "right"),
      h(3, s("invoice.payment")),
      p(s("invoice.paymentText")),
    ].join(""),
  }),
};

export function buildStarter(starter: DocumentStarter, t: TFunction, language: string): StudioDocument {
  const text = (key: string) => escapeHtml(t(`studio.doc.starters.${key}`));
  const today = escapeHtml(new Date().toLocaleDateString(language, { dateStyle: "long" }));
  const built = BUILDERS[starter](text, today);
  const name = starter === "blank" ? "" : t(`studio.doc.starters.names.${starter}`);
  return createDocument(name, built.html, { tocTitle: t("studio.doc.settings.tocTitleDefault"), ...built.settings });
}
