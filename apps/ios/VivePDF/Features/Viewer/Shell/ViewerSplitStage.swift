import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Split window (desktop `viewer/split`): the document next to (or above) a read-only second pane showing the
/// same document elsewhere or another PDF, with optional synchronised scrolling. Phones always stack.
struct ViewerSplitStage<Primary: View>: View {
    @Bindable var session: ViewerSession
    @ViewBuilder var primary: () -> Primary
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var ratio: CGFloat = 0.5
    @State private var pane = ViewerSplitPaneModel()

    private var stacked: Bool { session.splitStacked || sizeClass == .compact }

    var body: some View {
        GeometryReader { proxy in
            let total = stacked ? proxy.size.height : proxy.size.width
            let first = max(120, min(total - 120, total * ratio))
            let layout = stacked ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
            layout {
                primary()
                    .frame(width: stacked ? nil : first, height: stacked ? first : nil)
                divider(total: total)
                ViewerSplitPane(session: session, model: pane)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .coordinateSpace(name: "split")
        }
        .onAppear { pane.load(url: session.splitURL, primary: session) }
        .onChange(of: session.splitURL) { _, url in pane.load(url: url, primary: session) }
        .onChange(of: session.currentPageIndex) { _, page in pane.follow(primaryPage: page) }
    }

    private func divider(total: CGFloat) -> some View {
        ZStack {
            Rectangle().fill(Palette.border).frame(width: stacked ? nil : 1, height: stacked ? 1 : nil)
            Capsule().fill(Color.secondary.opacity(0.5)).frame(width: stacked ? 36 : 5, height: stacked ? 5 : 36)
        }
        .frame(width: stacked ? nil : 14, height: stacked ? 14 : nil)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .named("split")).onChanged { value in
            // Coordinates follow the layout direction, so this is the distance from the leading/top edge.
            let position = stacked ? value.location.y : value.location.x
            ratio = min(0.85, max(0.15, position / max(total, 1)))
        })
        .accessibilityElement()
        .accessibilityLabel(t("viewer.split.divider"))
        .accessibilityValue("\(Int(ratio * 100))%")
        .accessibilityAdjustableAction { direction in
            ratio = direction == .increment ? min(0.85, ratio + 0.05) : max(0.15, ratio - 0.05)
        }
    }
}

/// State of the second pane.
@MainActor
@Observable
final class ViewerSplitPaneModel {
    var document: PDFDocument?
    var name = ""
    var separate = false
    var needsPassword = false
    var wrongPassword = false
    var failed = false
    var syncScroll = true
    var page = 0
    @ObservationIgnored var url: URL?
    @ObservationIgnored weak var view: PDFView?
    @ObservationIgnored private var offset = 0

    func load(url: URL?, primary: ViewerSession) {
        failed = false
        needsPassword = false
        wrongPassword = false
        guard let url, url.standardizedFileURL != primary.document.url.standardizedFileURL else {
            self.url = nil
            separate = false
            document = primary.pdf
            name = primary.document.fileName
            page = primary.currentPageIndex
            offset = 0
            return
        }
        self.url = url
        separate = true
        name = url.lastPathComponent
        let known = AppModel.shared.documents.documents.first { $0.url.standardizedFileURL == url.standardizedFileURL }
        let pdf = known?.pdf ?? withSecurityScope(url) { PDFDocument(url: url) }
        guard let pdf else { failed = true; document = nil; return }
        if pdf.isLocked { needsPassword = true }
        document = pdf
        page = min(primary.currentPageIndex, max(0, pdf.pageCount - 1))
        offset = page - primary.currentPageIndex
    }

    func unlock(_ password: String) {
        guard let document else { return }
        if document.unlock(withPassword: password) { needsPassword = false; wrongPassword = false } else { wrongPassword = true }
    }

    /// Re-anchors the page offset when the reader scrolls the pane itself.
    func paneMoved(to page: Int, primaryPage: Int) {
        self.page = page
        offset = page - primaryPage
    }

    func follow(primaryPage: Int) {
        guard syncScroll, let document, let view, document.pageCount > 0 else { return }
        let target = min(max(0, primaryPage + offset), document.pageCount - 1)
        guard target != page, let destination = document.page(at: target) else { return }
        page = target
        view.go(to: destination)
    }
}

private struct ViewerSplitPane: View {
    let session: ViewerSession
    @Bindable var model: ViewerSplitPaneModel
    @Environment(AppModel.self) private var app
    @State private var importing = false
    @State private var password = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if model.failed {
                    EmptyStateView(symbol: "exclamationmark.triangle", title: t("viewer.split.openFailed"))
                } else if model.needsPassword {
                    passwordForm
                } else if let document = model.document {
                    ViewerReadOnlyCanvas(document: document, startPage: model.page, model: model, primary: session)
                        .pageColorScheme(session.pageColors)
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.background)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result { session.splitURL = url }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("viewer.split.pane", ["name": model.name]))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "eye").foregroundStyle(.secondary)
            Menu {
                Button { session.splitURL = nil } label: { Label(t("viewer.split.sameDocument"), systemImage: model.separate ? "doc" : "checkmark") }
                let others = app.documents.documents.filter { $0.id != session.document.id }
                if !others.isEmpty {
                    Section {
                        ForEach(others) { other in
                            Button { session.splitURL = other.url } label: { Text(other.fileName) }
                        }
                    }
                }
                Button { importing = true } label: { Label(t("viewer.split.chooseFile"), systemImage: "folder") }
            } label: {
                HStack(spacing: 4) {
                    Text(model.name).font(.subheadline.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                    Image(systemName: "chevron.down").font(.caption2)
                }
            }
            .accessibilityLabel(t("viewer.split.pickDocument", ["name": model.name]))
            Text(t("viewer.split.readOnly"))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Palette.muted, in: Capsule())
            if !model.separate && session.document.isDirty {
                Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.warning)
                    .help(t("viewer.split.unsaved"))
                    .accessibilityLabel(t("viewer.split.unsaved"))
            }
            Spacer(minLength: 4)
            if let document = model.document {
                Text("\(model.page + 1) / \(document.pageCount)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Toggle(isOn: $model.syncScroll) { Image(systemName: model.syncScroll ? "link" : "link.badge.plus") }
                .toggleStyle(.button)
                .accessibilityLabel(t("viewer.split.syncScroll"))
            Button { session.splitActive = false } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }
                .accessibilityLabel(t("viewer.split.close"))
        }
        .buttonStyle(.borderless)
        .controlSize(.small)
        .padding(.horizontal, 10)
        .frame(minHeight: 44)
        .background(.bar)
    }

    private var passwordForm: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(Palette.primary)
            Text(t("password.description", ["name": model.name])).multilineTextAlignment(.center)
            SecureField(t("password.label"), text: $password)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 320)
                .onSubmit { model.unlock(password) }
            if model.wrongPassword { Text(t("password.wrong")).foregroundStyle(Palette.destructive).font(.callout) }
            Button(t("password.open")) { model.unlock(password) }.buttonStyle(.borderedProminent).disabled(password.isEmpty)
        }
        .padding(24)
    }
}

/// Plain read-only page view for the second pane (no editing, own position).
private struct ViewerReadOnlyCanvas: UIViewRepresentable {
    let document: PDFDocument
    let startPage: Int
    let model: ViewerSplitPaneModel
    let primary: ViewerSession

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.backgroundColor = .secondarySystemBackground
        view.displayMode = .singlePageContinuous
        view.autoScales = true
        view.document = document
        model.view = view
        if let page = document.page(at: startPage) { DispatchQueue.main.async { view.go(to: page) } }
        context.coordinator.observe(view)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document {
            view.document = document
            view.autoScales = true
        }
        model.view = view
    }

    func makeCoordinator() -> Coordinator { Coordinator(model: model, primary: primary) }

    @MainActor
    final class Coordinator: NSObject {
        let model: ViewerSplitPaneModel
        let primary: ViewerSession
        private var token: NSObjectProtocol?
        init(model: ViewerSplitPaneModel, primary: ViewerSession) {
            self.model = model
            self.primary = primary
        }

        func observe(_ view: PDFView) {
            token = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak self, weak view] _ in
                MainActor.assumeIsolated {
                    guard let self, let view, let page = view.currentPage, let document = view.document else { return }
                    let index = document.index(for: page)
                    if index != self.model.page { self.model.paneMoved(to: index, primaryPage: self.primary.currentPageIndex) }
                }
            }
        }

        deinit {
            if let token { NotificationCenter.default.removeObserver(token) }
        }
    }
}
