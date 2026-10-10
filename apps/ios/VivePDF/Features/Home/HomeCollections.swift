import SwiftUI
import UniformTypeIdentifiers

/// "Collections": named groups of files opened together (`CollectionsSection.tsx`, `CollectionView.tsx`).
struct CollectionsSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @State private var draft: CollectionDraft?
    @State private var viewing: FileCollection?
    @State private var nothingToOpen = false
    private var store: CollectionsStore { .shared }

    var body: some View {
        let collections = store.ordered
        HomeCard(title: t("home.collections.title"), size: size) {
            if !collections.isEmpty {
                Button { startCreating() } label: { Label(t("home.collections.new"), systemImage: "plus") }
                    .font(.footnote).buttonStyle(.borderless)
            }
        } content: {
            if collections.isEmpty {
                VStack(spacing: 10) {
                    ToneTile(symbol: "books.vertical", size: 44)
                    Text(t("home.collections.emptyTitle")).font(.subheadline.weight(.medium))
                    Text(t("home.collections.emptyDescription")).font(.caption).foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    Button { startCreating() } label: { Label(t("home.collections.create"), systemImage: "plus") }
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, size.pick(8, 24, 40))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: size.pick(200, 240, 300)), spacing: 12)], spacing: 12) {
                    ForEach(Array(collections.enumerated()), id: \.element.id) { index, collection in
                        CollectionCard(collection: collection, index: index, total: collections.count,
                                       pinnedCount: collections.filter(\.pinned).count, preview: size.pick(0, 3, 6),
                                       onView: { viewing = collection },
                                       onEdit: { draft = CollectionDraft(collection) },
                                       onOpen: { open(collection.files) })
                    }
                }
            }
        }
        .sheet(item: $draft) { draft in CollectionEditor(draft: draft) }
        .sheet(item: $viewing) { collection in
            CollectionDetail(collectionID: collection.id, onEdit: { edit in
                viewing = nil
                draft = CollectionDraft(edit)
            }, onOpen: { files in
                viewing = nil
                open(files)
            })
        }
        .alert(t("home.collections.nothingToOpen"), isPresented: $nothingToOpen) { Button(t("common.close"), role: .cancel) {} }
    }

    private func startCreating() {
        draft = CollectionDraft(id: nil, name: "", files: app.documents.documents.map { CollectionFile(url: $0.url) })
    }

    private func open(_ files: [CollectionFile]) {
        let urls = files.compactMap { $0.resolve() }
        guard !urls.isEmpty else { nothingToOpen = true; return }
        var openedPDF = false
        for url in urls {
            if url.pathExtension.lowercased() == "pdf" {
                if app.documents.open(url) != nil { openedPDF = true }
            } else {
                app.open(url)
            }
        }
        if openedPDF { app.navigate(.viewer) }
    }
}

struct CollectionDraft: Identifiable {
    /// nil while creating a new collection.
    var collectionID: String?
    var name: String
    var files: [CollectionFile]
    let id = UUID()

    init(id: String?, name: String, files: [CollectionFile]) {
        collectionID = id
        self.name = name
        self.files = files
    }

    init(_ collection: FileCollection) {
        self.init(id: collection.id, name: collection.name, files: collection.files)
    }
}

private struct CollectionCard: View {
    let collection: FileCollection
    let index: Int
    let total: Int
    let pinnedCount: Int
    let preview: Int
    let onView: () -> Void
    let onEdit: () -> Void
    let onOpen: () -> Void
    @Environment(AppModel.self) private var app
    @State private var confirmDelete = false
    private var store: CollectionsStore { .shared }

    private var isFirst: Bool { index == 0 || index == pinnedCount }
    private var isLast: Bool { index == total - 1 || index == pinnedCount - 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Button(action: onView) {
                    HStack(alignment: .top, spacing: 10) {
                        ToneTile(symbol: "books.vertical", tone: collection.color.color, soft: collection.color.color.opacity(0.15), size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(collection.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                                if collection.pinned {
                                    Image(systemName: "pin.fill").font(.caption2).foregroundStyle(collection.color.color)
                                        .accessibilityLabel(t("home.collections.pinned"))
                                }
                            }
                            Text(t("home.collections.files", ["count": collection.files.count])).font(.caption).foregroundStyle(Palette.mutedForeground)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("home.collections.viewOf", ["name": collection.name]))
                Menu { menuItems } label: { Image(systemName: "ellipsis").frame(width: 32, height: 32) }
                    .accessibilityLabel(t("home.collections.actions", ["name": collection.name]))
            }
            if preview > 0 {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(collection.files.prefix(preview)) { file in
                        Button {
                            if let url = file.resolve() { app.open(url) }
                        } label: {
                            Text(file.name).font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(1).truncationMode(.middle)
                                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(t("home.collections.openFile", ["name": file.name]))
                    }
                    if collection.files.count > preview {
                        Button(t("home.collections.more", ["count": collection.files.count - preview]), action: onView)
                            .font(.caption).buttonStyle(.plain).foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            HStack(spacing: 8) {
                Button(action: onView) { Image(systemName: "eye").frame(minHeight: 22) }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(t("home.collections.view"))
                Button(action: onOpen) { Text(t("home.collections.open")).frame(maxWidth: .infinity, minHeight: 22) }
                    .buttonStyle(.bordered)
                    .disabled(collection.files.isEmpty)
            }
            .controlSize(.small)
        }
        .padding(12)
        .padding(.top, 4)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12).fill(collection.color.color).frame(height: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
        .contextMenu { menuItems }
        .confirmationDialog(t("home.collections.remove"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(t("home.collections.remove"), role: .destructive) { store.remove(collection.id) }
            Button(t("common.cancel"), role: .cancel) {}
        } message: { Text(collection.name) }
    }

    @ViewBuilder private var menuItems: some View {
        Button(action: onView) { Label(t("home.collections.view"), systemImage: "eye") }
        Button(action: onEdit) { Label(t("home.collections.edit"), systemImage: "pencil") }
        if collection.pinned {
            Button { store.setPinned(collection.id, false) } label: { Label(t("home.collections.unpin"), systemImage: "pin.slash") }
        } else {
            Button { store.setPinned(collection.id, true) } label: { Label(t("home.collections.pin"), systemImage: "pin") }
        }
        Button { store.move(collection.id, to: index - 1) } label: { Label(t("home.collections.moveEarlier"), systemImage: "arrow.backward") }
            .disabled(isFirst)
        Button { store.move(collection.id, to: index + 1) } label: { Label(t("home.collections.moveLater"), systemImage: "arrow.forward") }
            .disabled(isLast)
        Menu {
            ForEach(GroupColor.allCases) { color in
                Button { store.recolor(collection.id, color) } label: {
                    if collection.color == color { Label(t(color.labelKey), systemImage: "checkmark") } else { Text(t(color.labelKey)) }
                }
            }
        } label: { Label(t("viewer.tabGroups.color"), systemImage: "paintpalette") }
        Divider()
        Button(role: .destructive) { confirmDelete = true } label: { Label(t("home.collections.remove"), systemImage: "trash") }
    }
}

/// Create / edit sheet (`CollectionDialog`).
struct CollectionEditor: View {
    @State var draft: CollectionDraft
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var importing = false

    private var valid: Bool { !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && !draft.files.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section(t("home.collections.name")) {
                    TextField(t("home.collections.namePlaceholder"), text: $draft.name)
                        .onChange(of: draft.name) { _, value in
                            if value.count > FileCollection.nameMax { draft.name = String(value.prefix(FileCollection.nameMax)) }
                        }
                        .submitLabel(.done)
                }
                Section {
                    if draft.files.isEmpty {
                        Text(t("home.collections.noFiles")).font(.callout).foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(draft.files) { file in
                        Label { Text(file.name).lineLimit(1).truncationMode(.middle) } icon: { FileIcon(url: URL(fileURLWithPath: file.path), size: 28) }
                    }
                    .onDelete { draft.files.remove(atOffsets: $0) }
                    .onMove { draft.files.move(fromOffsets: $0, toOffset: $1) }
                    Button { importing = true } label: { Label(t("home.collections.addFiles"), systemImage: "doc.badge.plus") }
                        .disabled(draft.files.count >= FileCollection.filesMax)
                    let openCount = app.documents.documents.count
                    if openCount > 0 {
                        Button {
                            draft.files = FileCollection.unique(draft.files + app.documents.documents.map { CollectionFile(url: $0.url) })
                        } label: { Label(t("home.collections.addOpen", ["count": openCount]), systemImage: "book") }
                    }
                } header: {
                    Text(t("home.collections.files", ["count": draft.files.count]))
                }
            }
            .navigationTitle(t(draft.collectionID == nil ? "home.collections.createTitle" : "home.collections.editTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("home.collections.save"), action: save).disabled(!valid) }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: UTType.convertible, allowsMultipleSelection: true) { result in
                if case .success(let urls) = result {
                    draft.files = FileCollection.unique(draft.files + urls.map(CollectionFile.init(url:)))
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        guard valid else { return }
        if let id = draft.collectionID {
            CollectionsStore.shared.edit(id, name: draft.name, files: draft.files)
        } else {
            CollectionsStore.shared.create(name: draft.name, files: draft.files)
        }
        dismiss()
    }
}

/// File list of one collection: colour, search, sort, multi-select, open or remove (`CollectionView.tsx`).
struct CollectionDetail: View {
    let collectionID: String
    let onEdit: (FileCollection) -> Void
    let onOpen: ([CollectionFile]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var sort: CollectionSort = .collection
    @State private var selection = Set<String>()
    @State private var editMode: EditMode = .inactive
    private var store: CollectionsStore { .shared }

    var body: some View {
        NavigationStack {
            if let collection = store.collection(collectionID) {
                content(collection)
            } else {
                EmptyStateView(symbol: "books.vertical", title: t("home.collections.noFiles"))
            }
        }
        .presentationDetents([.large])
    }

    private func content(_ collection: FileCollection) -> some View {
        let shown = CollectionOrdering.matching(CollectionOrdering.sorted(collection.files, by: sort), query: query)
        let selected = collection.files.filter { selection.contains($0.path) }
        return List(selection: $selection) {
            Section(t("home.collections.color")) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(GroupColor.allCases) { color in
                            Button { store.recolor(collection.id, color) } label: {
                                Circle().fill(color.color).frame(width: 30, height: 30)
                                    .overlay { if collection.color == color { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                                    .overlay(Circle().strokeBorder(Palette.foreground.opacity(collection.color == color ? 0.6 : 0), lineWidth: 2).padding(-3))
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(t(color.labelKey))
                            .accessibilityAddTraits(collection.color == color ? .isSelected : [])
                        }
                    }
                }
            }
            Section {
                if collection.files.isEmpty {
                    Text(t("home.collections.noFiles")).foregroundStyle(Palette.mutedForeground)
                } else if shown.isEmpty {
                    Text(t("home.collections.noMatches", ["query": query.trimmingCharacters(in: .whitespaces)])).foregroundStyle(Palette.mutedForeground)
                }
                ForEach(shown) { file in
                    let url = file.resolve()
                    Button {
                        if let url { dismiss(); app.open(url) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: url == nil ? "exclamationmark.triangle" : "doc.text")
                                .foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(file.name).lineLimit(1).truncationMode(.middle)
                                Text(url == nil ? t("home.collections.missing") : file.folder)
                                    .font(.caption2).foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                                    .lineLimit(1).truncationMode(.head)
                            }
                        }
                    }
                    .foregroundStyle(Palette.foreground)
                    .disabled(url == nil && editMode == .inactive)
                    .tag(file.path)
                    .swipeActions {
                        Button(role: .destructive) { store.removeFiles(collection.id, paths: [file.path]) } label: {
                            Label(t("home.collections.removeFile"), systemImage: "minus.circle")
                        }
                    }
                    .contextMenu {
                        if let url {
                            Button { dismiss(); app.open(url) } label: { Label(t("home.collections.openFile", ["name": file.name]), systemImage: "book") }
                            Button { HomeActions.revealInFiles(url) } label: { Label(t("tools.reveal"), systemImage: "folder") }
                        }
                        Button(role: .destructive) { store.removeFiles(collection.id, paths: [file.path]) } label: {
                            Label(t("home.collections.removeFile"), systemImage: "minus.circle")
                        }
                    }
                }
            } header: {
                Text(t("home.collections.files", ["count": collection.files.count]))
            }
        }
        .environment(\.editMode, $editMode)
        .searchable(text: $query, prompt: t("home.collections.search"))
        .navigationTitle(collection.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker(t("home.collections.sort"), selection: $sort) {
                        ForEach(CollectionSort.allCases) { Text(t($0.labelKey)).tag($0) }
                    }
                    Button { onEdit(collection) } label: { Label(t("home.collections.edit"), systemImage: "pencil") }
                    if collection.files.count > 1 {
                        Button {
                            withAnimation { editMode = editMode == .active ? .inactive : .active; selection = [] }
                        } label: { Label(t("home.collections.selectAll"), systemImage: "checkmark.circle") }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel(t("home.collections.actions", ["name": collection.name]))
            }
            ToolbarItemGroup(placement: .bottomBar) {
                if editMode == .active {
                    Button(t("home.collections.selectAll")) {
                        let paths = Set(shown.map(\.path))
                        selection = selection.isSuperset(of: paths) ? selection.subtracting(paths) : selection.union(paths)
                    }
                    Spacer()
                    Text(t("home.collections.selected", ["count": selected.count])).font(.footnote).foregroundStyle(Palette.mutedForeground)
                    Spacer()
                    Button(role: .destructive) {
                        store.removeFiles(collection.id, paths: Set(selected.map(\.path)))
                        selection = []
                    } label: { Label(t("home.collections.removeSelected"), systemImage: "trash") }
                        .disabled(selected.isEmpty)
                    Button { onOpen(selected) } label: { Label(t("home.collections.openSelected"), systemImage: "folder") }
                        .disabled(selected.isEmpty)
                } else {
                    Button { onEdit(collection) } label: { Label(t("home.collections.edit"), systemImage: "pencil") }
                    Spacer()
                    Button { onOpen(CollectionOrdering.sorted(collection.files, by: sort)) } label: {
                        Label(t("home.collections.open"), systemImage: "folder").labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(collection.files.isEmpty)
                }
            }
        }
    }
}
