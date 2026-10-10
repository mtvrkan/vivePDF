import PDFKit
import SwiftUI

/// One visible line of the outline tree (`outlineTree.ts` `OutlineRow`).
struct ViewerOutlineRow: Identifiable {
    let id: String
    let parentId: String?
    let depth: Int
    let title: String
    let item: PDFOutline
    let pageIndex: Int?
    let url: URL?
    let hasChildren: Bool

    var ancestorIds: [String] {
        let parts = id.split(separator: ".").map(String.init)
        return (1..<max(1, parts.count)).map { parts.prefix($0).joined(separator: ".") }
    }
}

/// Outline reading/editing helpers. PDFKit edits the tree in memory; it is written when the document is saved.
@MainActor
enum ViewerOutline {
    static func rows(_ pdf: PDFDocument) -> [ViewerOutlineRow] {
        guard let root = pdf.outlineRoot else { return [] }
        var rows: [ViewerOutlineRow] = []
        func visit(_ parent: PDFOutline, parentId: String?, depth: Int) {
            for index in 0..<parent.numberOfChildren {
                guard let child = parent.child(at: index) else { continue }
                let id = parentId.map { "\($0).\(index)" } ?? "\(index)"
                let page = (child.destination?.page ?? (child.action as? PDFActionGoTo)?.destination.page).map { pdf.index(for: $0) }
                let url = (child.action as? PDFActionURL)?.url
                let title = (child.label ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
                rows.append(ViewerOutlineRow(id: id, parentId: parentId, depth: depth, title: title, item: child,
                                             pageIndex: page.flatMap { $0 == NSNotFound ? nil : $0 }, url: url, hasChildren: child.numberOfChildren > 0))
                visit(child, parentId: id, depth: depth + 1)
            }
        }
        visit(root, parentId: nil, depth: 0)
        return rows
    }

    /// The deepest entry at or before the current page (`activeOutlineId`).
    static func activeId(_ rows: [ViewerOutlineRow], page: Int) -> String? {
        var best: ViewerOutlineRow?
        for row in rows {
            guard let target = row.pageIndex, target <= page else { continue }
            if best == nil || target >= (best?.pageIndex ?? 0) { best = row }
        }
        return best?.id
    }

    static func normalized(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
    }

    static func visible(_ rows: [ViewerOutlineRow], expanded: Set<String>, filter: String) -> [ViewerOutlineRow] {
        let query = normalized(filter.trimmingCharacters(in: .whitespaces))
        if !query.isEmpty {
            var shown = Set<String>()
            for row in rows where normalized(row.title).contains(query) {
                shown.insert(row.id)
                row.ancestorIds.forEach { shown.insert($0) }
            }
            return rows.filter { shown.contains($0.id) }
        }
        return rows.filter { $0.ancestorIds.allSatisfy(expanded.contains) }
    }

    // MARK: Undoable editing via whole-tree snapshots (PDFOutline nodes can't be re-parented safely otherwise).

    struct Node {
        var label: String
        var destination: PDFDestination?
        var action: PDFAction?
        var isOpen: Bool
        var children: [Node]
    }

    static func snapshot(_ pdf: PDFDocument) -> [Node]? {
        guard let root = pdf.outlineRoot else { return nil }
        func capture(_ item: PDFOutline) -> Node {
            Node(label: item.label ?? "", destination: item.destination, action: item.action, isOpen: item.isOpen,
                 children: (0..<item.numberOfChildren).compactMap { item.child(at: $0).map(capture) })
        }
        return (0..<root.numberOfChildren).compactMap { root.child(at: $0).map(capture) }
    }

    static func restore(_ nodes: [Node]?, into pdf: PDFDocument) {
        guard let nodes else { pdf.outlineRoot = nil; return }
        let root = PDFOutline()
        func build(_ node: Node) -> PDFOutline {
            let item = PDFOutline()
            item.label = node.label
            if let destination = node.destination { item.destination = destination } else if let action = node.action { item.action = action }
            for (index, child) in node.children.enumerated() { item.insertChild(build(child), at: index) }
            item.isOpen = node.isOpen
            return item
        }
        for (index, node) in nodes.enumerated() { root.insertChild(build(node), at: index) }
        pdf.outlineRoot = root
    }

    /// Runs an edit with undo support.
    static func edit(_ session: ViewerSession, _ change: () -> Void) {
        let before = snapshot(session.pdf)
        change()
        register(session, restoring: before)
        session.markEdited()
    }

    private static func register(_ session: ViewerSession, restoring nodes: [Node]?) {
        session.undoManager.registerUndo(withTarget: session) { target in
            MainActor.assumeIsolated {
                let current = snapshot(target.pdf)
                restore(nodes, into: target.pdf)
                register(target, restoring: current)
                target.markEdited()
            }
        }
    }

    static func rootCreatingIfNeeded(_ pdf: PDFDocument) -> PDFOutline {
        if let root = pdf.outlineRoot { return root }
        let root = PDFOutline()
        pdf.outlineRoot = root
        return root
    }

    static func destination(page: PDFPage) -> PDFDestination {
        let bounds = page.bounds(for: .cropBox)
        return PDFDestination(page: page, at: CGPoint(x: bounds.minX, y: bounds.maxY))
    }

    static func indent(_ item: PDFOutline) {
        guard let parent = item.parent, item.index > 0, let previous = parent.child(at: item.index - 1) else { return }
        item.removeFromParent()
        previous.insertChild(item, at: previous.numberOfChildren)
        previous.isOpen = true
    }

    static func outdent(_ item: PDFOutline) {
        guard let parent = item.parent, let grand = parent.parent else { return }
        let at = parent.index + 1
        item.removeFromParent()
        grand.insertChild(item, at: at)
    }
}

/// Bookmarks / table of contents (desktop `OutlinePanel` + `OutlineEditor`).
struct ViewerOutlinePanel: View {
    let session: ViewerSession
    @Environment(AppModel.self) private var app
    @State private var expanded: Set<String> = []
    @State private var filter = ""
    @State private var editing = false
    @State private var renaming: ViewerOutlineRow?
    @State private var renameText = ""
    @State private var seeded = false

    private var rows: [ViewerOutlineRow] {
        _ = session.revision
        return ViewerOutline.rows(session.pdf)
    }

    var body: some View {
        let rows = rows
        let visible = ViewerOutline.visible(rows, expanded: expanded, filter: filter)
        let active = ViewerOutline.activeId(rows, page: session.currentPageIndex)
        let marked = active.flatMap { id in visible.contains { $0.id == id } ? id : rows.first { $0.id == id }?.ancestorIds.reversed().first { a in visible.contains { $0.id == a } } }
        Group {
            if rows.isEmpty && !editing {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    List {
                        if editing {
                            Section {
                                Button { addAtCurrentPage() } label: {
                                    Label(t("viewer.outline.addAtPage", ["page": session.label(ofPage: session.currentPageIndex)]), systemImage: "bookmark.fill")
                                }
                            } footer: { Text(t("viewer.outline.editEmptyHint")) }
                        }
                        if !filter.isEmpty && visible.isEmpty {
                            Text(t("viewer.outline.noMatches")).foregroundStyle(.secondary)
                        }
                        ForEach(visible) { row in
                            rowView(row, marked: row.id == marked)
                                .id(row.id)
                        }
                    }
                    .listStyle(.plain)
                    .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .always), prompt: t("viewer.outline.filter"))
                    .onAppear { if let marked { proxy.scrollTo(marked, anchor: .center) } }
                    .onChange(of: marked) { _, id in
                        guard let id, filter.isEmpty else { return }
                        withAnimation { proxy.scrollTo(id, anchor: .center) }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if !editing && rows.contains(where: \.hasChildren) {
                    Menu {
                        Button { expanded = Set(rows.filter(\.hasChildren).map(\.id)) } label: { Label(t("viewer.outline.expandAll"), systemImage: "chevron.down.2") }
                        Button { expanded = [] } label: { Label(t("viewer.outline.collapseAll"), systemImage: "chevron.up.2") }
                    } label: { Label(t("viewer.outline.title"), systemImage: "list.bullet.indent") }
                }
                Button { withAnimation { editing.toggle() } } label: {
                    Label(t("viewer.outline.edit"), systemImage: editing ? "checkmark.circle.fill" : "pencil")
                }
            }
        }
        .onAppear(perform: seedExpansion)
        .onChange(of: active) { _, id in
            guard let id, let row = rows.first(where: { $0.id == id }) else { return }
            expanded.formUnion(row.ancestorIds)
        }
        .alert(t("viewer.outline.rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(t("viewer.context.bookmarkName"), text: $renameText)
            Button(t("common.cancel"), role: .cancel) { renaming = nil }
            Button(t("viewer.outline.rename")) {
                if let row = renaming {
                    let text = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { ViewerOutline.edit(session) { row.item.label = text } }
                }
                renaming = nil
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "list.bullet.indent").font(.system(size: 36, weight: .light)).foregroundStyle(Palette.primary)
            Text(t("viewer.outline.empty")).font(.headline)
            Text(t("viewer.outline.emptyHint")).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button { withAnimation { editing = true } } label: {
                Label(t("viewer.outline.addAtPage", ["page": session.label(ofPage: session.currentPageIndex)]), systemImage: "bookmark")
            }
            .buttonStyle(.borderedProminent)
            Button { app.navigate(.tool(.edit, tab: "bookmarks")) } label: { Label(t("viewer.outline.create"), systemImage: "list.bullet.rectangle") }
                .buttonStyle(.bordered)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func rowView(_ row: ViewerOutlineRow, marked: Bool) -> some View {
        let open = !filter.isEmpty || expanded.contains(row.id)
        return HStack(spacing: 6) {
            if row.hasChildren && filter.isEmpty {
                Button {
                    withAnimation(.snappy) { if open { expanded.remove(row.id) } else { expanded.insert(row.id) } }
                } label: {
                    Image(systemName: "chevron.forward")
                        .font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 28, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(open ? t("viewer.outline.collapseAll") : t("viewer.outline.expandAll"))
            } else {
                Color.clear.frame(width: 28, height: 1)
            }
            Button { activate(row) } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.title.isEmpty ? t("viewer.outline.untitled") : row.title)
                        .font(.subheadline.weight(marked ? .semibold : .regular))
                        .foregroundStyle(row.pageIndex == nil && row.url == nil ? .secondary : .primary)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    if let page = row.pageIndex {
                        Text(session.label(ofPage: page)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    } else if row.url != nil {
                        Image(systemName: "arrow.up.forward.square").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if editing { editMenu(row) }
        }
        .padding(.leading, CGFloat(row.depth) * 16)
        .listRowBackground(marked ? Palette.accent : Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 12))
        .swipeActions(edge: .trailing) {
            if editing {
                Button(role: .destructive) { ViewerOutline.edit(session) { row.item.removeFromParent() } } label: { Label(t("common.delete"), systemImage: "trash") }
            }
        }
        .contextMenu { if !editing { Button { renameText = row.title; renaming = row } label: { Label(t("viewer.outline.rename"), systemImage: "pencil") } } }
    }

    private func editMenu(_ row: ViewerOutlineRow) -> some View {
        Menu {
            Button { renameText = row.title; renaming = row } label: { Label(t("viewer.outline.rename"), systemImage: "pencil") }
            Button { addChild(to: row) } label: { Label(t("viewer.outline.addChild"), systemImage: "text.badge.plus") }
            Button {
                guard let page = session.currentPage else { return }
                ViewerOutline.edit(session) { row.item.destination = ViewerOutline.destination(page: page) }
            } label: { Label(t("viewer.outline.linkToPage", ["page": session.label(ofPage: session.currentPageIndex)]), systemImage: "link") }
            Button { ViewerOutline.edit(session) { ViewerOutline.indent(row.item) } } label: { Label(t("ios.viewer.outline.indent"), systemImage: "increase.indent") }
                .disabled(row.item.index == 0)
            Button { ViewerOutline.edit(session) { ViewerOutline.outdent(row.item) } } label: { Label(t("ios.viewer.outline.outdent"), systemImage: "decrease.indent") }
                .disabled(row.depth == 0)
            Divider()
            Button(role: .destructive) { ViewerOutline.edit(session) { row.item.removeFromParent() } } label: { Label(t("common.delete"), systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis.circle").frame(width: 36, height: 36).contentShape(Rectangle())
        }
        .accessibilityLabel(t("viewer.outline.editTools"))
    }

    private func activate(_ row: ViewerOutlineRow) {
        if let destination = row.item.destination ?? (row.item.action as? PDFActionGoTo)?.destination {
            session.go(to: destination)
        } else if let page = row.pageIndex {
            session.go(toPage: page)
        } else if let url = row.url {
            session.linkPrompt = url
        }
    }

    private func addAtCurrentPage() {
        guard let page = session.currentPage else { return }
        let selected = ViewerText.bookmarkTitle(from: session.selectedText)
        let title = selected.isEmpty ? t("viewer.outline.newBookmark") : selected
        ViewerOutline.edit(session) {
            let root = ViewerOutline.rootCreatingIfNeeded(session.pdf)
            let item = PDFOutline()
            item.label = title
            item.destination = ViewerOutline.destination(page: page)
            var at = root.numberOfChildren
            for index in 0..<root.numberOfChildren {
                if let target = root.child(at: index)?.destination?.page, session.pdf.index(for: target) > session.currentPageIndex { at = index; break }
            }
            root.insertChild(item, at: at)
        }
    }

    private func addChild(to row: ViewerOutlineRow) {
        guard let page = session.currentPage else { return }
        ViewerOutline.edit(session) {
            let item = PDFOutline()
            item.label = t("viewer.outline.newBookmark")
            item.destination = ViewerOutline.destination(page: page)
            row.item.insertChild(item, at: row.item.numberOfChildren)
            row.item.isOpen = true
        }
        expanded.insert(row.id)
    }

    private func seedExpansion() {
        guard !seeded else { return }
        seeded = true
        expanded = Set(rows.filter { $0.hasChildren && $0.item.isOpen }.map(\.id))
    }
}
