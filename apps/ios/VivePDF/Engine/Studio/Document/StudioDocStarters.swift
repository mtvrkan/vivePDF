import Foundation

/// Port of `document/starters.ts`: the ten starter documents, built from translated sample text.
enum StudioDocStarter: String, CaseIterable, Identifiable {
    case blank, report, letter, petition, assignment, minutes, lectureNotes, booklet, cv, invoice
    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .blank: "doc"
        case .report: "chart.bar.doc.horizontal"
        case .letter: "envelope"
        case .petition: "signature"
        case .assignment: "graduationcap"
        case .minutes: "person.3"
        case .lectureNotes: "note.text"
        case .booklet: "book.closed"
        case .cv: "person.text.rectangle"
        case .invoice: "doc.plaintext"
        }
    }

    private static func p(_ value: String, _ align: String? = nil) -> String { "<p\(align.map { " style=\"text-align:\($0)\"" } ?? "")>\(value)</p>" }
    private static func h(_ level: Int, _ value: String, _ align: String? = nil) -> String { "<h\(level)\(align.map { " style=\"text-align:\($0)\"" } ?? "")>\(value)</h\(level)>" }
    private static func list(_ items: [String], ordered: Bool = false) -> String {
        let tag = ordered ? "ol" : "ul"
        return "<\(tag)>\(items.map { "<li><p>\($0)</p></li>" }.joined())</\(tag)>"
    }
    private static func tasks(_ items: [String]) -> String {
        "<ul data-type=\"taskList\">\(items.map { "<li data-type=\"taskItem\" data-checked=\"false\"><p>\($0)</p></li>" }.joined())</ul>"
    }
    private static func table(_ header: [String]?, _ rows: [[String]]) -> String {
        let head = header.map { "<tr>\($0.map { "<th><p>\($0)</p></th>" }.joined())</tr>" } ?? ""
        return "<table>\(head)\(rows.map { "<tr>\($0.map { "<td><p>\($0)</p></td>" }.joined())</tr>" }.joined())</table>"
    }
    private static func strong(_ value: String) -> String { "<strong>\(value)</strong>" }

    private func build(_ s: (String) -> String, _ today: String) -> (html: String, settings: (inout StudioDocSettings) -> Void) {
        typealias S = StudioDocStarter
        switch self {
        case .blank:
            return ("", { _ in })
        case .report:
            return ([
                S.h(1, s("report.summary")), S.p(s("common.paragraph"), "justify"),
                S.h(1, s("report.background")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("report.goals")), S.list([s("report.goal1"), s("report.goal2"), s("report.goal3")]),
                S.h(1, s("report.findings")), S.p(s("common.paragraphShort"), "justify"),
                S.table([s("report.item"), s("report.value"), s("report.note")], [[s("report.row1"), "42", s("report.noteGood")], [s("report.row2"), "17", s("report.noteWatch")]]),
                S.h(1, s("report.conclusion")), S.p(s("common.paragraph"), "justify"),
            ].joined(), { $0.cover = true; $0.toc = true; $0.title = s("report.title"); $0.subtitle = s("report.subtitle"); $0.date = today; $0.coverStyle = .band })
        case .letter:
            return ([
                S.p("\(S.strong(s("common.yourName")))<br>\(s("common.address"))<br>\(s("common.contact"))", "right"),
                S.p(today, "right"),
                S.p("\(s("letter.recipient"))<br>\(s("letter.recipientAddress"))"),
                S.p(S.strong("\(s("letter.subjectLabel")): \(s("letter.subject"))")),
                S.p(s("letter.greeting")),
                S.p(s("common.paragraph"), "justify"),
                S.p(s("common.paragraphShort"), "justify"),
                S.p(s("letter.closing")),
                S.p("<br>\(s("common.yourName"))"),
            ].joined(), { $0.pageNumbers = .none })
        case .petition:
            return ([
                S.h(3, s("petition.addressee"), "center"), S.p("&nbsp;"),
                S.p(s("petition.body"), "justify"), S.p(s("petition.request"), "justify"), S.p("&nbsp;"),
                S.p("\(today)<br>\(s("common.yourName"))<br>\(s("petition.signature"))", "right"),
                S.p("\(S.strong("\(s("petition.addressLabel")):")) \(s("common.address"))"),
                S.p(S.strong("\(s("petition.attachments")):")),
                S.list([s("petition.attachment1")], ordered: true),
            ].joined(), { $0.pageNumbers = .none; $0.marginMm = 25 })
        case .assignment:
            return ([
                S.h(1, s("assignment.title"), "center"),
                S.p("\(s("common.yourName"))<br>\(s("assignment.course"))<br>\(today)", "center"),
                S.h(2, s("assignment.introduction")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("assignment.method")), S.p(s("common.paragraphShort"), "justify"),
                S.h(2, s("assignment.results")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("assignment.conclusion")), S.p(s("common.paragraphShort"), "justify"),
                S.h(2, s("assignment.references")), S.list([s("assignment.reference1"), s("assignment.reference2")], ordered: true),
            ].joined(), { _ in })
        case .minutes:
            return ([
                S.h(1, s("minutes.title"), "center"),
                S.table(nil, [
                    [S.strong(s("minutes.date")), today], [S.strong(s("minutes.place")), s("minutes.placeValue")],
                    [S.strong(s("minutes.chair")), s("common.yourName")], [S.strong(s("minutes.attendees")), s("minutes.attendeesValue")],
                ]),
                S.h(2, s("minutes.agenda")), S.list([s("minutes.agenda1"), s("minutes.agenda2"), s("minutes.agenda3")], ordered: true),
                S.h(2, s("minutes.discussion")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("minutes.decisions")), S.list([s("minutes.decision1"), s("minutes.decision2")], ordered: true),
                S.h(2, s("minutes.actions")), S.tasks([s("minutes.action1"), s("minutes.action2")]),
                S.p("&nbsp;"),
                S.table([s("minutes.signatureName"), s("minutes.signature")], [["", ""], ["", ""]]),
            ].joined(), { _ in })
        case .lectureNotes:
            return ([
                S.h(1, s("lectureNotes.topic")),
                S.p("\(S.strong(s("lectureNotes.course"))) · \(today)"),
                S.h(2, s("lectureNotes.keyIdeas")), S.list([s("lectureNotes.idea1"), s("lectureNotes.idea2"), s("lectureNotes.idea3")]),
                "<blockquote>\(S.p(s("lectureNotes.remember")))</blockquote>",
                S.h(2, s("lectureNotes.details")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("lectureNotes.review")), S.tasks([s("lectureNotes.review1"), s("lectureNotes.review2")]),
            ].joined(), { $0.fontSize = 10.5; $0.marginMm = 16; $0.header = s("lectureNotes.course"); $0.headerAlign = .left })
        case .booklet:
            return ([
                S.h(1, s("booklet.chapter1")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("booklet.section1")), S.p(s("common.paragraphShort"), "justify"),
                "<div data-page-break=\"\"></div>",
                S.h(1, s("booklet.chapter2")), S.p(s("common.paragraph"), "justify"),
                S.h(2, s("booklet.section2")), S.p(s("common.paragraphShort"), "justify"),
            ].joined(), {
                $0.paper = .a5; $0.marginMm = 15; $0.fontSize = 10.5; $0.cover = true; $0.toc = true; $0.coverStyle = .frame
                $0.title = s("booklet.title"); $0.subtitle = s("booklet.subtitle"); $0.date = today; $0.pageNumbers = .outside
            })
        case .cv:
            return ([
                S.h(1, s("common.yourName")),
                S.p("\(s("cv.role")) · \(s("common.contact")) · \(s("common.address"))"),
                "<hr>",
                S.h(2, s("cv.profile")), S.p(s("cv.profileText"), "justify"),
                S.h(2, s("cv.experience")),
                S.h(3, s("cv.job1")), S.p(s("cv.job1Dates")), S.list([s("cv.achievement1"), s("cv.achievement2")]),
                S.h(3, s("cv.job2")), S.p(s("cv.job2Dates")), S.list([s("cv.achievement3")]),
                S.h(2, s("cv.education")), S.p("\(S.strong(s("cv.school")))<br>\(s("cv.schoolDates"))"),
                S.h(2, s("cv.skills")), S.list([s("cv.skill1"), s("cv.skill2"), s("cv.skill3")]),
            ].joined(), { $0.pageNumbers = .none; $0.marginMm = 18; $0.accent = "#0f766e" })
        case .invoice:
            return ([
                S.h(1, s("invoice.title")),
                S.p("\(S.strong(s("invoice.company")))<br>\(s("common.address"))<br>\(s("common.contact"))"),
                S.table(nil, [[S.strong(s("invoice.number")), "2026-001"], [S.strong(s("invoice.date")), today], [S.strong(s("invoice.due")), s("invoice.dueValue")]]),
                S.h(3, s("invoice.billTo")),
                S.p("\(s("letter.recipient"))<br>\(s("letter.recipientAddress"))"),
                S.table([s("invoice.description"), s("invoice.quantity"), s("invoice.price"), s("invoice.amount")], [[s("invoice.item1"), "2", "150.00", "300.00"], [s("invoice.item2"), "1", "80.00", "80.00"]]),
                S.p("\(s("invoice.subtotal")): 380.00<br>\(s("invoice.tax")): 76.00<br>\(S.strong("\(s("invoice.total")): 456.00"))", "right"),
                S.h(3, s("invoice.payment")), S.p(s("invoice.paymentText")),
            ].joined(), { $0.pageNumbers = .none; $0.accent = "#1e3a8a" })
        }
    }

    /// `buildStarter`: a new document with translated sample content and the starter's settings.
    func document(language: String, translate: (String) -> String = { t($0) }, date: Date = Date()) -> StudioDocument {
        let text: (String) -> String = { StudioDocHTML.escape(translate("studio.doc.starters.\($0)")) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: language)
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        let today = StudioDocHTML.escape(formatter.string(from: date))
        let built = build(text, today)
        var settings = StudioDocSettings()
        settings.tocTitle = translate("studio.doc.settings.tocTitleDefault")
        built.settings(&settings)
        let name = self == .blank ? "" : translate("studio.doc.starters.names.\(rawValue)")
        return StudioDocument(name: name, settings: settings, content: .html(built.html))
    }
}
