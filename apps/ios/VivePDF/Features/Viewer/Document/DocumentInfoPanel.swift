import PDFKit
import SwiftUI

/// Document info + properties editor (desktop `Inspector`: `DocumentInfoCard` + `MetadataEditor`).
struct DocumentInfoPanel: View {
    let session: ViewerSession

    @State private var facts: DocumentFacts?
    @State private var fonts: [String]?
    @State private var values = MetadataValues()
    @State private var loaded = MetadataValues()
    @State private var saving = false

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        Form {
            if let facts {
                Section { header(facts) }
                Section {
                    row(t("info.size"), Workspace.formatBytes(facts.bytes))
                    row(t("info.version"), facts.version)
                    row(t("info.pageSize"), facts.pageSize)
                    row(t("info.encrypted"), yesNo(facts.encrypted))
                    row(t("info.toc"), yesNo(facts.hasOutline))
                    row(t("info.forms"), yesNo(facts.hasForms))
                    row(t("info.attachments"), yesNo(facts.hasAttachments))
                }
                if facts.encrypted || !facts.permissions.allSatisfy(\.allowed) {
                    Section(t("ios.viewer.document.permissions")) {
                        ForEach(facts.permissions, id: \.key) { permission in
                            row(t("ios.viewer.document.perm.\(permission.key)"), yesNo(permission.allowed))
                        }
                    }
                }
                Section {
                    DisclosureGroup {
                        if let fonts {
                            if fonts.isEmpty {
                                Text("—").foregroundStyle(Palette.mutedForeground)
                            } else {
                                ForEach(fonts, id: \.self) { Text($0).font(.footnote) }
                            }
                        } else {
                            ProgressView().task { await loadFonts() }
                        }
                    } label: {
                        Text(t("ios.viewer.document.fonts"))
                    }
                }
            } else {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }

            Section {
                field("title", text: $values.title)
                field("author", text: $values.author)
                field("subject", text: $values.subject)
                field("keywords", text: $values.keywords)
                TextField(t("info.creator"), text: $values.creator).textInputAutocapitalization(.never)
                    .accessibilityLabel(t("info.creator"))
                TextField(t("info.producer"), text: $values.producer).textInputAutocapitalization(.never)
                    .accessibilityLabel(t("info.producer"))
                DatePicker(t("info.creationDate"), selection: dateBinding(\.created), displayedComponents: [.date, .hourAndMinute])
                DatePicker(t("info.modDate"), selection: dateBinding(\.modified), displayedComponents: [.date, .hourAndMinute])
            } header: {
                Text(t("viewer.metadata.title"))
            } footer: {
                if session.pdf.isEncrypted {
                    PanelFootnote(text: t("ios.viewer.document.metadataEncrypted"), symbol: "lock")
                }
            }

            Section {
                ViewThatFits(in: .horizontal) {
                    HStack { applyButton; Spacer(); saveButton }
                    VStack(alignment: .leading, spacing: 10) { saveButton; applyButton }
                }
            }
        }
        .task(id: DocumentReloadKey(session)) { load() }
    }

    // MARK: - Pieces

    private func header(_ facts: DocumentFacts) -> some View {
        HStack(spacing: 14) {
            FileIcon(url: session.document.url, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(facts.pageCount.formatted()).font(.title.bold().monospacedDigit())
                Text("\(t("info.pages")) · \(Workspace.formatBytes(facts.bytes))").font(.caption).foregroundStyle(Palette.mutedForeground)
                Text(session.document.fileName).font(.subheadline.weight(.semibold)).lineLimit(2).truncationMode(.middle)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func row(_ label: String, _ value: String) -> some View {
        LabeledContent(label) {
            Text(value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
    }

    private func yesNo(_ value: Bool) -> String { value ? t("common.yes") : t("common.no") }

    private func field(_ key: String, text: Binding<String>) -> some View {
        TextField(t("viewer.metadata.fields.\(key)"), text: text, axis: .vertical)
            .lineLimit(1...4)
            .accessibilityLabel(t("viewer.metadata.fields.\(key)"))
    }

    private func dateBinding(_ path: WritableKeyPath<MetadataValues, Date?>) -> Binding<Date> {
        Binding(get: { values[keyPath: path] ?? Date() }, set: { values[keyPath: path] = $0 })
    }

    private var applyButton: some View {
        Button { apply() } label: { Label(t("ios.viewer.document.applyMetadata"), systemImage: "checkmark") }
            .buttonStyle(.bordered)
            .disabled(values == loaded || saving || session.pdf.isEncrypted)
    }

    private var saveButton: some View {
        Button { save() } label: {
            if saving { ProgressView() } else { Label(t("viewer.metadata.save"), systemImage: "square.and.arrow.down") }
        }
        .buttonStyle(.borderedProminent)
        .disabled((values == loaded && !session.document.isDirty) || saving || session.pdf.isEncrypted)
    }

    // MARK: - Loading & saving

    private func load() {
        let pdf = session.pdf
        facts = DocumentFacts(session: session)
        fonts = nil
        let current = MetadataValues(attributes: pdf.documentAttributes ?? [:])
        // Keep what the reader is typing when only the revision changed.
        if values == loaded { values = current }
        loaded = current
    }

    private func loadFonts() async {
        guard let document = session.pdf.documentRef else { fonts = []; return }
        fonts = await Task.detached(priority: .utility) { DocumentInfoReader.fontNames(in: document) }.value
    }

    private func apply() {
        var attributes = session.pdf.documentAttributes ?? [:]
        values.write(into: &attributes)
        session.pdf.documentAttributes = attributes
        loaded = values
        session.markEdited()
    }

    private func save() {
        saving = true
        defer { saving = false }
        let wanted = values
        apply()
        guard session.save() else { return }
        // PDFKit only writes changed properties into an existing /Info dictionary. A file that had none
        // gets one on the first save, so the properties are applied once more and saved again.
        if !wanted.matches(session.pdf.documentAttributes ?? [:]) {
            var attributes = session.pdf.documentAttributes ?? [:]
            wanted.write(into: &attributes)
            session.pdf.documentAttributes = attributes
            session.markEdited()
            _ = session.save()
        }
        values = wanted
        loaded = MetadataValues(attributes: session.pdf.documentAttributes ?? [:])
        session.show(ViewerToast(text: t("viewer.metadata.saved")))
    }
}

/// Editable `/Info` fields. PDFKit's attribute dictionary uses string keys; keywords come back as an array.
struct MetadataValues: Equatable {
    var title = ""
    var author = ""
    var subject = ""
    var keywords = ""
    var creator = ""
    var producer = ""
    var created: Date?
    var modified: Date?

    init() {}

    init(attributes: [AnyHashable: Any]) {
        func string(_ key: PDFDocumentAttribute) -> String { (attributes[key.rawValue] ?? attributes[key]) as? String ?? "" }
        title = string(.titleAttribute)
        author = string(.authorAttribute)
        subject = string(.subjectAttribute)
        creator = string(.creatorAttribute)
        producer = string(.producerAttribute)
        let rawKeywords = attributes[PDFDocumentAttribute.keywordsAttribute.rawValue] ?? attributes[PDFDocumentAttribute.keywordsAttribute]
        if let list = rawKeywords as? [String] { keywords = list.joined(separator: ", ") } else { keywords = rawKeywords as? String ?? "" }
        created = (attributes[PDFDocumentAttribute.creationDateAttribute.rawValue] ?? attributes[PDFDocumentAttribute.creationDateAttribute]) as? Date
        modified = (attributes[PDFDocumentAttribute.modificationDateAttribute.rawValue] ?? attributes[PDFDocumentAttribute.modificationDateAttribute]) as? Date
    }

    var keywordList: [String] {
        keywords.split(whereSeparator: { $0 == "," || $0 == ";" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    func write(into attributes: inout [AnyHashable: Any]) {
        func set(_ key: PDFDocumentAttribute, _ value: Any?) {
            attributes[key] = nil
            if let text = value as? String, text.trimmingCharacters(in: .whitespaces).isEmpty {
                attributes[key.rawValue] = nil
            } else {
                attributes[key.rawValue] = value
            }
        }
        set(.titleAttribute, title)
        set(.authorAttribute, author)
        set(.subjectAttribute, subject)
        set(.keywordsAttribute, keywordList.isEmpty ? nil : keywordList)
        set(.creatorAttribute, creator)
        set(.producerAttribute, producer)
        set(.creationDateAttribute, created)
        set(.modificationDateAttribute, modified)
    }

    /// True when the text fields equal what `attributes` holds (dates are rewritten by some writers).
    func matches(_ attributes: [AnyHashable: Any]) -> Bool {
        let other = MetadataValues(attributes: attributes)
        return other.title == title && other.author == author && other.subject == subject
            && other.keywordList == keywordList && other.creator == creator
    }
}

/// The facts shown in the info card.
struct DocumentFacts {
    struct Permission { let key: String; let allowed: Bool }

    let pageCount: Int
    let bytes: Int64
    let version: String
    let pageSize: String
    let encrypted: Bool
    let hasOutline: Bool
    let hasForms: Bool
    let hasAttachments: Bool
    let permissions: [Permission]

    @MainActor init(session: ViewerSession) {
        let pdf = session.pdf
        pageCount = pdf.pageCount
        bytes = Workspace.fileSize(session.document.url)
        version = "\(pdf.majorVersion).\(pdf.minorVersion)"
        if let page = session.currentPage {
            let box = page.bounds(for: .cropBox)
            let quarter = (page.rotation / 90) % 2 != 0
            pageSize = DocumentFormat.pageSize(quarter ? CGSize(width: box.height, height: box.width) : box.size)
        } else {
            pageSize = "—"
        }
        encrypted = pdf.isEncrypted
        hasOutline = (pdf.outlineRoot?.numberOfChildren ?? 0) > 0
        let document = pdf.documentRef
        hasForms = document.map(DocumentInfoReader.hasFormFields) ?? false
        hasAttachments = document.map { !AttachmentEngine.list(in: $0).isEmpty } ?? false
        permissions = [
            Permission(key: "print", allowed: pdf.allowsPrinting),
            Permission(key: "copy", allowed: pdf.allowsCopying),
            Permission(key: "edit", allowed: pdf.allowsDocumentChanges),
            Permission(key: "comment", allowed: pdf.allowsCommenting),
            Permission(key: "forms", allowed: pdf.allowsFormFieldEntry),
            Permission(key: "assemble", allowed: pdf.allowsDocumentAssembly),
            Permission(key: "accessibility", allowed: pdf.allowsContentAccessibility),
        ]
    }
}
