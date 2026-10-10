import PDFKit
import SwiftUI

// MARK: - Page control

/// Floating page navigator + zoom (desktop `PageNavigator`, `ZoomInput`, rail zoom buttons).
struct ViewerPageControl: View {
    @Bindable var session: ViewerSession
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        HStack(spacing: 2) {
            Button { session.previousPage() } label: { Image(systemName: "chevron.backward").frame(width: 40, height: 40) }
                .disabled(session.currentPageIndex <= 0)
                .accessibilityLabel(t("viewer.previousPage"))
            Button { session.showGoToPage = true } label: {
                Text(pageText)
                    .font(.subheadline.monospacedDigit().weight(.medium))
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .frame(minWidth: 64, minHeight: 40)
            }
            .accessibilityLabel(t("viewer.pageNumber"))
            .accessibilityValue(pageText)
            .accessibilityHint(t("viewer.context.goToPage"))
            Button { session.nextPage() } label: { Image(systemName: "chevron.forward").frame(width: 40, height: 40) }
                .disabled(session.currentPageIndex >= session.pageCount - 1)
                .accessibilityLabel(t("viewer.nextPage"))
            Divider().frame(height: 22).padding(.horizontal, 4)
            if sizeClass != .compact {
                Button { session.zoom(.zoomOut) } label: { Image(systemName: "minus.magnifyingglass").frame(width: 40, height: 40) }
                    .accessibilityLabel(t("viewer.zoomOut"))
            }
            Menu {
                ViewerZoomMenuItems(session: session)
            } label: {
                Text("\(Int((session.scale * 100).rounded()))%")
                    .font(.footnote.monospacedDigit())
                    .frame(minWidth: 50, minHeight: 40)
            }
            .accessibilityLabel(t("viewer.zoomInput"))
            if sizeClass != .compact {
                Button { session.zoom(.zoomIn) } label: { Image(systemName: "plus.magnifyingglass").frame(width: 40, height: 40) }
                    .accessibilityLabel(t("viewer.zoomIn"))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 6)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("viewer.pageNavigation"))
    }

    private var pageText: String {
        let label = session.label(ofPage: session.currentPageIndex)
        return label == "\(session.currentPageIndex + 1)" ? "\(label) / \(session.pageCount)" : "\(label) (\(session.currentPageIndex + 1) / \(session.pageCount))"
    }
}

struct ViewerZoomMenuItems: View {
    let session: ViewerSession
    var body: some View {
        Button { session.zoom(.fitWidth) } label: { Label(t("viewer.fitWidth"), systemImage: "arrow.left.and.right") }
        Button { session.zoom(.fitPage) } label: { Label(t("viewer.fitPage"), systemImage: "arrow.up.left.and.down.right.magnifyingglass") }
        Button { session.zoom(.actualSize) } label: { Label(t("viewer.actualSize"), systemImage: "1.magnifyingglass") }
        Divider()
        ForEach(ViewerSession.zoomPresets.reversed(), id: \.self) { level in
            Button("\(Int(level * 100))%") { session.zoom(.level(level)) }
        }
    }
}

// MARK: - Toast

struct ViewerToastView: View {
    let toast: ViewerToast
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.symbol).foregroundStyle(toast.isError ? Palette.destructive : Palette.success)
            Text(toast.text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            if let title = toast.actionTitle, let action = toast.action {
                Button(title) { action(); dismiss() }
                    .font(.subheadline.weight(.semibold))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: 560)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        .onTapGesture(perform: dismiss)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        .onAppear { UIAccessibility.post(notification: .announcement, argument: toast.text) }
    }
}

// MARK: - Banners

/// Document messages under the toolbar (desktop `DocumentMessageBar`, `FileChangedBanner`, `StudioDesignMessage`,
/// `FormXfaNotice`): changed on disk, signatures, fillable forms, Studio design, scanned pages.
struct ViewerBanners: View {
    @Bindable var session: ViewerSession
    @Environment(AppModel.self) private var app
    @State private var checks = ViewerDocumentChecks()
    @State private var dismissed: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            fileChanged
            if let status = ViewerModules.signatureBanner(session: session), !dismissed.contains("signatures") {
                row(symbol: status.symbol, tint: status.tint, text: status.text) {
                    Button(t("viewer.messages.signatures.panel")) { session.leadingPanel = .signatures }
                } dismiss: { dismissed.insert("signatures") }
            }
            if checks.xfaOnly, !dismissed.contains("xfa") {
                row(symbol: "exclamationmark.triangle", tint: Palette.warning, text: t("viewer.formFill.xfaOnly")) {
                    Button(t("nav.forms")) { app.navigate(.tool(.forms, tab: "fill")) }
                } dismiss: { dismissed.insert("xfa") }
            } else if checks.hasForms, !dismissed.contains("forms") {
                row(symbol: "list.clipboard", tint: Palette.primary, text: t("viewer.messages.forms.present")) {
                    Toggle(t("viewer.messages.forms.highlight"), isOn: $session.highlightFields)
                        .toggleStyle(.button)
                } dismiss: { dismissed.insert("forms"); session.highlightFields = false }
            }
            if checks.studioDesign, !dismissed.contains("studio") {
                row(symbol: "paintpalette", tint: Palette.primary, text: t("viewer.messages.studio.present")) {
                    Button(t("viewer.messages.studio.open")) {
                        app.inbox = [session.document.url]
                        app.navigate(.studio())
                    }
                } dismiss: { dismissed.insert("studio") }
            }
            if checks.scanned, !dismissed.contains("scanned") {
                row(symbol: "text.viewfinder", tint: Palette.primary, text: t("viewer.searchable.title")) {
                    Button(t("viewer.searchable.run")) { session.makeSearchablePage = .some(nil) }
                } dismiss: { dismissed.insert("scanned") }
            }
        }
        .task(id: ObjectIdentifier(session.pdf)) {
            checks = ViewerDocumentChecks.run(session.pdf)
        }
    }

    @ViewBuilder private var fileChanged: some View {
        let document = session.document
        let missing = !FileManager.default.fileExists(atPath: document.url.path)
        if missing && !dismissed.contains("missing") {
            row(symbol: "doc.questionmark", tint: Palette.destructive, text: t("viewer.fileChanged.missing", ["name": document.fileName])) {
                Button(t("viewer.fileChanged.saveCopy")) { _ = session.saveCopy(suffix: "copy") }
            } dismiss: { dismissed.insert("missing") }
        } else if document.changedOnDisk {
            let conflict = document.isDirty
            row(symbol: "arrow.clockwise", tint: conflict ? Palette.destructive : Palette.primary,
                text: t(conflict ? "viewer.fileChanged.conflict" : "viewer.fileChanged.changed", ["name": document.fileName])) {
                Button(t("viewer.fileChanged.reload")) { session.reloadFromDisk(); session.showMessage(t("viewer.fileChanged.updated")) }
                if conflict { Button(t("viewer.fileChanged.keepMine")) { document.changedOnDisk = false } }
            } dismiss: { document.changedOnDisk = false }
        }
    }

    private func row<Actions: View>(symbol: String, tint: Color, text: String, @ViewBuilder actions: () -> Actions, dismiss: @escaping () -> Void) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                Image(systemName: symbol).foregroundStyle(tint)
                Text(text).font(.subheadline).lineLimit(2)
                Spacer(minLength: 8)
                actions().buttonStyle(.bordered).controlSize(.small)
                closeButton(dismiss)
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: symbol).foregroundStyle(tint)
                    Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    closeButton(dismiss)
                }
                HStack { actions() }.buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(tint.opacity(0.08))
        .overlay(alignment: .bottom) { Divider() }
    }

    private func closeButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 32, height: 32).contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel(t("viewer.messages.dismiss"))
    }
}

/// Cheap structural checks read from the catalog with Core Graphics (no page parsing).
struct ViewerDocumentChecks {
    var hasForms = false
    var xfaOnly = false
    var studioDesign = false
    var scanned = false

    @MainActor
    static func run(_ pdf: PDFDocument) -> ViewerDocumentChecks {
        var result = ViewerDocumentChecks()
        if let catalog = pdf.documentRef?.catalog {
            var acroForm: CGPDFDictionaryRef?
            if CGPDFDictionaryGetDictionary(catalog, "AcroForm", &acroForm), let acroForm {
                var fields: CGPDFArrayRef?
                let count = CGPDFDictionaryGetArray(acroForm, "Fields", &fields) ? fields.map(CGPDFArrayGetCount) ?? 0 : 0
                var xfa: CGPDFObjectRef?
                let hasXFA = CGPDFDictionaryGetObject(acroForm, "XFA", &xfa)
                result.hasForms = count > 0
                result.xfaOnly = hasXFA && count == 0
            }
            var design: CGPDFObjectRef?
            result.studioDesign = CGPDFDictionaryGetObject(catalog, "VivePDFDesign", &design)
        }
        let sample = min(pdf.pageCount, 3)
        result.scanned = sample > 0 && (0..<sample).allSatisfy { (pdf.page(at: $0)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return result
    }
}

// MARK: - Auto scroll

/// Hands-free scrolling (desktop `AutoScroller`): eight speeds, reverse, stops at the end or on a tap.
@MainActor
final class ViewerAutoScroller {
    static let speeds: [CGFloat] = [15, 30, 50, 80, 120, 180, 270, 400]
    private weak var session: ViewerSession?
    private var link: CADisplayLink?
    private var previous: CFTimeInterval?
    private var carry: CGFloat = 0

    static func of(_ session: ViewerSession) -> ViewerAutoScroller {
        session.service(ViewerAutoScroller.self) { ViewerAutoScroller(session: session) }
    }

    private init(session: ViewerSession) { self.session = session }

    func toggle() { if session?.autoScrolling == true { stop() } else { start() } }

    func start() {
        guard let session, scrollView != nil else { return }
        session.autoScrolling = true
        previous = nil
        carry = 0
        let link = CADisplayLink(target: DisplayTarget(owner: self), selector: #selector(DisplayTarget.tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func stop() {
        link?.invalidate()
        link = nil
        session?.autoScrolling = false
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func faster() { session.map { $0.autoScrollSpeedIndex = min(Self.speeds.count - 1, $0.autoScrollSpeedIndex + 1) } }
    func slower() { session.map { $0.autoScrollSpeedIndex = max(0, $0.autoScrollSpeedIndex - 1) } }
    func reverse() { session?.autoScrollBackwards.toggle() }

    private var scrollView: UIScrollView? {
        guard let view = session?.pdfView else { return nil }
        func find(_ view: UIView) -> UIScrollView? {
            if let scroll = view as? UIScrollView { return scroll }
            for sub in view.subviews { if let found = find(sub) { return found } }
            return nil
        }
        return find(view)
    }

    fileprivate func tick(_ link: CADisplayLink) {
        guard let session, let scroll = scrollView else { stop(); return }
        defer { previous = link.timestamp }
        guard let previous else { return }
        let elapsed = min(link.timestamp - previous, 0.25)
        let distance = Self.speeds[session.autoScrollSpeedIndex] * CGFloat(elapsed) + carry
        let whole = distance.rounded(.towardZero)
        carry = distance - whole
        let horizontal = session.direction == .horizontal
        var offset = scroll.contentOffset
        let step = session.autoScrollBackwards ? -whole : whole
        if horizontal {
            let maxX = scroll.contentSize.width - scroll.bounds.width + scroll.adjustedContentInset.right
            let minX = -scroll.adjustedContentInset.left
            if (step > 0 && offset.x >= maxX - 1) || (step < 0 && offset.x <= minX) { stop(); return }
            offset.x = min(maxX, max(minX, offset.x + step))
        } else {
            let maxY = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
            let minY = -scroll.adjustedContentInset.top
            if (step > 0 && offset.y >= maxY - 1) || (step < 0 && offset.y <= minY) { stop(); return }
            offset.y = min(maxY, max(minY, offset.y + step))
        }
        scroll.contentOffset = offset
    }

    private final class DisplayTarget: NSObject {
        weak var owner: ViewerAutoScroller?
        init(owner: ViewerAutoScroller) { self.owner = owner }
        @objc func tick(_ link: CADisplayLink) {
            MainActor.assumeIsolated { owner?.tick(link) }
        }
    }
}

struct ViewerAutoScrollHUD: View {
    let session: ViewerSession

    var body: some View {
        let scroller = ViewerAutoScroller.of(session)
        HStack(spacing: 4) {
            Image(systemName: session.autoScrollBackwards ? "arrow.up" : "arrow.down").foregroundStyle(Palette.primary)
                .rotationEffect(.degrees(session.direction == .horizontal ? -90 : 0))
            Button { scroller.slower() } label: { Image(systemName: "tortoise").frame(width: 40, height: 40) }
                .disabled(session.autoScrollSpeedIndex == 0)
                .accessibilityLabel(t("ios.viewer.slower"))
            Text("\(session.autoScrollSpeedIndex + 1)/\(ViewerAutoScroller.speeds.count)").font(.caption.monospacedDigit())
            Button { scroller.faster() } label: { Image(systemName: "hare").frame(width: 40, height: 40) }
                .disabled(session.autoScrollSpeedIndex == ViewerAutoScroller.speeds.count - 1)
                .accessibilityLabel(t("ios.viewer.faster"))
            Button { scroller.reverse() } label: { Image(systemName: "arrow.up.arrow.down").frame(width: 40, height: 40) }
                .accessibilityLabel(t("ios.viewer.reverse"))
            Button { scroller.stop() } label: { Image(systemName: "stop.fill").frame(width: 40, height: 40) }
                .accessibilityLabel(t("viewer.readAloud.stop"))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("viewer.pageDisplay.autoScroll"))
    }
}
