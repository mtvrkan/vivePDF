import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Comments list with filters, threads, replies, review status, import/export (desktop `CommentsPanel`).
/// Content only: the viewer wraps it in a titled navigation container (inspector on iPad, sheet on iPhone).
struct CommentsPanel: View {
    let session: ViewerSession
    @State private var importing = false

    init(session: ViewerSession) {
        self.session = session
    }

    private var model: CommentsModel { CommentsModel.of(session) }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            CommentFilterBar(model: model)
            Divider()
            content
        }
        .task(id: session.revision) { model.reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Section(t("ios.viewer.comments.export")) {
                        ForEach(CommentsModel.ExportFormat.allCases) { format in
                            Button {
                                model.export(format)
                            } label: {
                                if let hint = format.hintKey {
                                    Text(format.title)
                                    Text(t(hint))
                                } else {
                                    Text(format.title)
                                }
                            }
                            .disabled(model.collection.records.isEmpty)
                        }
                    }
                    Button { importing = true } label: { Label(t("viewer.comments.import"), systemImage: "square.and.arrow.down") }
                    Button { model.reload() } label: { Label(t("viewer.comments.refresh"), systemImage: "arrow.clockwise") }
                } label: {
                    Label(t("ios.viewer.comments.more"), systemImage: "ellipsis.circle")
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.xfdf, .fdf, .xml]) { result in
            if case .success(let url) = result { model.importComments(from: url) }
        }
        .sheet(item: $model.exported) { item in
            NavigationStack {
                ScrollView {
                    ResultPanel(result: item.result).padding()
                }
                .navigationTitle(t("viewer.comments.title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { model.exported = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private var content: some View {
        let entries = model.entries
        if !model.loaded {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.collection.records.isEmpty {
            EmptyStateView(symbol: "text.bubble", title: t("viewer.comments.empty"), message: t("ios.viewer.comments.emptyHint"),
                           actionTitle: t("viewer.comments.import"), action: { importing = true })
        } else if entries.isEmpty {
            EmptyStateView(symbol: "line.3.horizontal.decrease.circle", title: t("viewer.comments.noMatches"),
                           actionTitle: t("search.clearFilters"), action: { model.clearFilters() })
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(entries) { entry in
                        CommentRow(model: model, entry: entry)
                    }
                }
                .padding(12)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

// MARK: - Filters

private struct CommentFilterBar: View {
    @Bindable var model: CommentsModel
    @FocusState private var pageFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chipMenu(title: model.author ?? t("viewer.comments.filterAuthor"), active: model.author != nil) {
                        Picker(t("viewer.comments.filterAuthor"), selection: $model.author) {
                            Text(t("viewer.comments.filterAuthor")).tag(String?.none)
                            ForEach(model.collection.authors, id: \.self) { Text($0).tag(String?.some($0)) }
                        }
                    }
                    chipMenu(title: model.type.map(model.typeLabel) ?? t("viewer.comments.filterType"), active: model.type != nil) {
                        Picker(t("viewer.comments.filterType"), selection: $model.type) {
                            Text(t("viewer.comments.filterType")).tag(String?.none)
                            ForEach(model.collection.types, id: \.self) { Text(model.typeLabel($0)).tag(String?.some($0)) }
                        }
                    }
                    chipMenu(title: statusTitle, active: model.status != .all) {
                        Picker(t("viewer.comments.filterStatus"), selection: $model.status) {
                            Text(t("viewer.comments.filterStatus")).tag(CommentsModel.StatusFilter.all)
                            Text(t("viewer.comments.noStatus")).tag(CommentsModel.StatusFilter.none)
                            ForEach(CommentsModel.reviewStates, id: \.self) { Text(model.stateLabel($0)).tag(CommentsModel.StatusFilter.state($0)) }
                        }
                    }
                    chipMenu(title: repliesTitle, active: model.replies != .all) {
                        Picker(t("viewer.comments.filterReplies"), selection: $model.replies) {
                            Text(t("viewer.comments.filterReplies")).tag(CommentsModel.RepliesFilter.all)
                            Text(t("viewer.comments.withReplies")).tag(CommentsModel.RepliesFilter.with)
                            Text(t("viewer.comments.withoutReplies")).tag(CommentsModel.RepliesFilter.without)
                        }
                    }
                    TextField(t("viewer.comments.page"), text: $model.page)
                        .keyboardType(.numberPad)
                        .focused($pageFocused)
                        .multilineTextAlignment(.center)
                        .frame(minWidth: 56, maxWidth: 80, minHeight: 36)
                        .padding(.horizontal, 8)
                        .background(Palette.card, in: Capsule())
                        .overlay(Capsule().strokeBorder(model.page.isEmpty ? Palette.border : Palette.primary.opacity(0.5)))
                        .accessibilityLabel(t("viewer.comments.page"))
                    Toggle(isOn: $model.showResolved) {
                        Text(t("viewer.comments.showResolved")).font(.subheadline).lineLimit(1)
                    }
                    .toggleStyle(.button)
                    .buttonBorderShape(.capsule)
                    .controlSize(.regular)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 2)
            }
            Text(t("viewer.comments.count", ["count": model.entries.count]))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
                .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                if pageFocused { Button(t("common.close")) { pageFocused = false } }
            }
        }
    }

    private var statusTitle: String {
        switch model.status {
        case .all: t("viewer.comments.filterStatus")
        case .none: t("viewer.comments.noStatus")
        case .state(let state): model.stateLabel(state)
        }
    }

    private var repliesTitle: String {
        switch model.replies {
        case .all: t("viewer.comments.filterReplies")
        case .with: t("viewer.comments.withReplies")
        case .without: t("viewer.comments.withoutReplies")
        }
    }

    private func chipMenu<Content: View>(title: String, active: Bool, @ViewBuilder content: () -> Content) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 4) {
                Text(title).font(.subheadline.weight(active ? .semibold : .regular)).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .foregroundStyle(active ? Palette.primary : Palette.foreground)
            .background(active ? Palette.accent : Palette.card, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? Palette.primary.opacity(0.45) : Palette.border))
        }
    }
}

// MARK: - Row

private struct CommentRow: View {
    let model: CommentsModel
    let entry: CommentThreadEntry
    @State private var confirmDelete = false
    @State private var draft = ""
    @Environment(\.dynamicTypeSize) private var typeSize

    private var record: CommentRecord { entry.record }
    private var heading: String { entry.depth > 0 ? t("viewer.comments.reply") : model.typeLabel(record.type) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if !record.quote.isEmpty {
                Text(record.quote)
                    .font(.callout.italic())
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(6)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Color(record.color ?? .systemYellow)).frame(width: 3)
                    }
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.editingID == record.id {
                CommentEditor(placeholder: t("annotate.notePlaceholder"), initial: record.content, submitTitle: t("ios.viewer.comments.saveEdit"),
                              onSubmit: { model.edit(record, content: $0) }, onCancel: { model.editingID = nil })
            } else if !record.content.isEmpty {
                Text(record.content)
                    .font(.body)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            footer
            if model.replyingTo == record.id {
                CommentEditor(placeholder: t("viewer.comments.replyPlaceholder"), initial: "", submitTitle: t("viewer.comments.reply"),
                              accessibility: t("viewer.comments.replyTo", ["name": record.author.isEmpty ? heading : record.author]),
                              onSubmit: { model.reply(to: record, content: $0) }, onCancel: { model.replyingTo = nil })
            }
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
        .opacity(record.resolved ? 0.65 : 1)
        .padding(.leading, CGFloat(min(entry.depth, 3)) * 16)
        .contextMenu { menuItems }
        .confirmationDialog(t("viewer.comments.delete"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(t("viewer.comments.delete"), role: .destructive) { model.delete(record) }
            Button(t("common.cancel"), role: .cancel) {}
        } message: {
            Text(t("ios.viewer.comments.deleteConfirm"))
        }
    }

    private var header: some View {
        Button { model.reveal(record) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if entry.depth > 0 {
                    Image(systemName: "arrowshape.turn.up.left").font(.footnote).foregroundStyle(Palette.mutedForeground)
                } else {
                    Circle().fill(Color(record.color ?? .clear)).overlay(Circle().strokeBorder(Palette.border)).frame(width: 10, height: 10)
                }
                Text(heading).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.foreground)
                    .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                if let state = record.state {
                    Text(model.stateLabel(state))
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .foregroundStyle(stateTint(state))
                        .background(stateTint(state).opacity(0.14), in: Capsule())
                }
                Spacer(minLength: 4)
                Text(t("viewer.comments.pageShort", ["page": record.pageIndex + 1]))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(t("viewer.context.goToPage"))
    }

    private var footer: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { meta; Spacer(minLength: 4); actions }
            VStack(alignment: .leading, spacing: 4) { meta; actions }
        }
    }

    @ViewBuilder private var meta: some View {
        let date = record.created ?? record.modified
        HStack(spacing: 4) {
            if !record.author.isEmpty { Text(record.author).lineLimit(1) }
            if !record.author.isEmpty && date != nil { Text("·") }
            if let date { Text(date, format: .dateTime.day().month(.abbreviated).year().hour().minute()).lineLimit(1) }
            if record.resolved { Text("· " + t("viewer.comments.resolved")) }
        }
        .font(.caption)
        .foregroundStyle(Palette.mutedForeground)
    }

    private var actions: some View {
        HStack(spacing: 0) {
            iconButton(t("viewer.comments.reply"), "arrowshape.turn.up.left", active: model.replyingTo == record.id) {
                model.editingID = nil
                model.replyingTo = model.replyingTo == record.id ? nil : record.id
            }
            Menu {
                statusPicker
            } label: {
                Image(systemName: "checklist").frame(width: 44, height: 44)
            }
            .accessibilityLabel(t("viewer.comments.status"))
            iconButton(record.resolved ? t("viewer.comments.unresolve") : t("viewer.comments.resolve"),
                       record.resolved ? "arrow.uturn.backward" : "checkmark.circle") { model.toggleResolved(record) }
            iconButton(t("viewer.comments.delete"), "trash", role: .destructive) { confirmDelete = true }
        }
        .foregroundStyle(Palette.mutedForeground)
    }

    private var statusPicker: some View {
        Picker(t("viewer.comments.status"), selection: Binding(get: { record.state }, set: { model.setState($0, for: record) })) {
            Text(t("viewer.comments.noStatus")).tag(String?.none)
            ForEach(CommentsModel.reviewStates, id: \.self) { Text(model.stateLabel($0)).tag(String?.some($0)) }
        }
    }

    @ViewBuilder private var menuItems: some View {
        Button { model.reveal(record) } label: { Label(t("viewer.context.goToPage"), systemImage: "arrow.right.doc.on.clipboard") }
        Button { UIPasteboard.general.string = record.content } label: { Label(t("viewer.context.copyText"), systemImage: "doc.on.doc") }
            .disabled(record.content.isEmpty)
        Button { model.editingID = nil; model.replyingTo = record.id } label: { Label(t("viewer.comments.reply"), systemImage: "arrowshape.turn.up.left") }
        if model.canEdit(record) {
            Button { model.replyingTo = nil; model.editingID = record.id } label: { Label(t("ios.viewer.comments.edit"), systemImage: "pencil") }
        }
        Button { model.toggleResolved(record) } label: {
            Label(record.resolved ? t("viewer.comments.unresolve") : t("viewer.comments.resolve"),
                  systemImage: record.resolved ? "arrow.uturn.backward" : "checkmark.circle")
        }
        Menu { statusPicker } label: { Label(t("viewer.comments.status"), systemImage: "checklist") }
        Divider()
        Button(role: .destructive) { confirmDelete = true } label: { Label(t("viewer.comments.delete"), systemImage: "trash") }
    }

    private func iconButton(_ label: String, _ symbol: String, active: Bool = false, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Image(systemName: symbol)
                .frame(width: 44, height: 44)
                .foregroundStyle(active ? Palette.primary : (role == .destructive ? Palette.destructive : Palette.mutedForeground))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func stateTint(_ state: String) -> Color {
        switch state {
        case "Accepted", "Completed": Palette.success
        case "Rejected": Palette.destructive
        default: Palette.warning
        }
    }
}

// MARK: - Reply / edit box

private struct CommentEditor: View {
    let placeholder: String
    let initial: String
    let submitTitle: String
    var accessibility: String? = nil
    let onSubmit: (String) -> Void
    let onCancel: () -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    private var content: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(3...8)
                .focused($focused)
                .padding(10)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityLabel(accessibility ?? placeholder)
                .onChange(of: text) { _, value in
                    if value.count > CommentsModel.replyLimit { text = String(value.prefix(CommentsModel.replyLimit)) }
                }
            HStack {
                Button(t("common.cancel"), role: .cancel, action: onCancel)
                    .keyboardShortcut(.escape, modifiers: [])
                Button(submitTitle) { if !content.isEmpty { onSubmit(content) } }
                    .buttonStyle(.borderedProminent)
                    .disabled(content.isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
            .controlSize(.regular)
        }
        .onAppear {
            text = initial
            focused = true
        }
    }
}
