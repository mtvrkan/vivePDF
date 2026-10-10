import PDFKit
import SwiftUI
import UIKit

/// Full-screen presentation (desktop immersive mode + presentation tools). Presented by the viewer shell
/// with `.fullScreenCover` while `session.presenting` is true; leaving sets it back to false.
///
/// With an external display connected (AirPlay, USB-C) the slide goes full screen there and this screen
/// becomes the presenter view: current slide (drawable), next slide, timer and the slide's text.
struct PresentationView: View {
    let session: ViewerSession
    let startPage: Int?
    @State private var controller: PresentationController
    @FocusState private var focused: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(session: ViewerSession, startPage: Int?) {
        self.session = session
        self.startPage = startPage
        _controller = State(initialValue: PresentationController.of(session))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if controller.externalConnected {
                PresenterConsole(controller: controller)
            } else {
                PresentationStage(controller: controller)
            }
            chrome
            if controller.overviewOpen {
                PresentationOverview(controller: controller)
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.opacity)
            }
            if !controller.jumpBuffer.isEmpty {
                Text(controller.jumpBuffer)
                    .font(.system(size: 44, weight: .bold).monospacedDigit())
                    .padding(.horizontal, 22).padding(.vertical, 10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .environment(\.colorScheme, .dark)
                    .allowsHitTesting(false)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in handle(press) }
        .onAppear {
            controller.begin(at: startPage)
            focused = true
            UIApplication.shared.isIdleTimerDisabled = true
            PresentationExternalDisplay.shared.start(controller)
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            PresentationExternalDisplay.shared.stop()
        }
        .onChange(of: controller.tool) { _, tool in
            // Drawing tools keep the bar up; the pointer hides it after a pause like the desktop cursor.
            if tool == .pointer || tool.tracksPointer { controller.scheduleHide() } else { controller.chromeVisible = true }
        }
        .onChange(of: controller.textDraftAt) { _, anchor in if anchor == nil { focused = true } }
        .animation(.easeInOut(duration: 0.2), value: controller.overviewOpen)
        .animation(.easeInOut(duration: 0.2), value: controller.blackout)
    }

    // MARK: Chrome

    @ViewBuilder
    private var chrome: some View {
        VStack {
            HStack {
                Spacer()
                TimerClockChip(controller: controller)
            }
            .padding(.horizontal)
            .padding(.top, 8)
            Spacer()
            if controller.chromeVisible {
                PresentationBar(controller: controller)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                // A thin strip at the bottom edge brings the bar back without turning the slide.
                Color.clear.frame(height: 28).contentShape(Rectangle())
                    .onTapGesture { controller.showChrome() }
                    .accessibilityLabel(t("presentation.settings"))
                    .accessibilityAddTraits(.isButton)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: controller.chromeVisible)
    }

    // MARK: Keyboard (desktop ViewerShortcuts in immersive mode)

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        let key = press.key
        let shift = press.modifiers.contains(.shift)
        let command = press.modifiers.contains(.command)
        if command {
            switch press.characters.lowercased() {
            case "z":
                if shift { controller.redoStroke() } else { controller.undo() }
                return .handled
            case "y":
                controller.redoStroke()
                return .handled
            default: return .ignored
            }
        }
        if key == .escape { escape(); return .handled }
        switch key {
        case .rightArrow, .downArrow, .space, .pageDown:
            controller.next(); return .handled
        case .leftArrow, .upArrow, .pageUp:
            controller.previous(); return .handled
        case .home:
            controller.go(to: 0); return .handled
        case .end:
            controller.go(to: controller.pageCount - 1); return .handled
        case .return:
            if !controller.commitJump() { controller.next() }
            return .handled
        case .delete, .deleteForward:
            if controller.tool == .select, controller.selectedID != nil { controller.deleteSelected() } else { controller.previous() }
            return .handled
        default: break
        }
        guard let character = press.characters.first else { return .ignored }
        if character.isASCII, character.isNumber {
            controller.typeDigit(character)
            return .handled
        }
        switch press.characters.lowercased() {
        case "l": controller.toggle(.laser)
        case "p": controller.toggle(.pen)
        case "h": controller.toggle(.highlighter)
        case "e":
            if shift { controller.clearVisible() } else { controller.toggle(.eraser) }
        case "s": controller.toggle(.spotlight)
        case "m": controller.toggle(.magnifier)
        case "v": controller.toggle(.select)
        case "z":
            if controller.zoomRect != nil { controller.zoomRect = nil } else { controller.areaZoomArmed.toggle() }
        case "b", ".": controller.toggleBlackout(.black)
        case "w": controller.toggleBlackout(.white)
        case "g": controller.overviewOpen.toggle()
        case "t":
            if !controller.prefs.showTimer { controller.prefs.showTimer = true }
            controller.toggleTimerRunning()
        case "c": controller.prefs.showClock.toggle()
        default: return .ignored
        }
        return .handled
    }

    /// Esc closes the innermost layer first: overview, area zoom, tool, blackout, then the presentation.
    private func escape() {
        if controller.overviewOpen { controller.overviewOpen = false; return }
        if controller.areaZoomArmed || controller.zoomRect != nil { controller.areaZoomArmed = false; controller.zoomRect = nil; return }
        if controller.tool != .pointer { controller.toggle(controller.tool); return }
        if controller.blackout != .none { controller.blackout = .none; return }
        controller.end()
    }
}

/// Presenter view while an external display shows the slides.
private struct PresenterConsole: View {
    @Bindable var controller: PresentationController

    var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width > proxy.size.height
            let content = Group {
                PresentationStage(controller: controller)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                side
                    .frame(width: wide ? min(360, proxy.size.width * 0.34) : nil)
                    .frame(height: wide ? nil : min(320, proxy.size.height * 0.4))
            }
            Group {
                if wide { HStack(spacing: 16) { content } } else { VStack(spacing: 12) { content } }
            }
            .padding(12)
            .padding(.bottom, 72)
        }
        .environment(\.colorScheme, .dark)
    }

    private var side: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(t("ios.viewer.presentation.external"), systemImage: "tv")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            TimerClockChip(controller: controller, large: true)
            Text(t("ios.viewer.presentation.slide", ["page": controller.pageIndex + 1, "total": controller.pageCount]))
                .font(.headline)
            if controller.pageIndex + 1 < controller.pageCount {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("ios.viewer.presentation.next")).font(.caption).foregroundStyle(.secondary)
                    PageThumbnail(page: controller.session.pdf.page(at: controller.pageIndex + 1), width: 150)
                }
            }
            Text(t("ios.viewer.presentation.notes")).font(.caption).foregroundStyle(.secondary)
            ScrollView {
                Text(notes)
                    .font(.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .foregroundStyle(.white)
        .padding(12)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
    }

    private var notes: String {
        let text = controller.session.text(ofPage: controller.pageIndex).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.count > 2000 ? String(text.prefix(2000)) + "…" : text
    }
}

/// Passive copy of the stage for the external screen.
struct PresentationExternalView: View {
    let controller: PresentationController

    var body: some View {
        PresentationStage(controller: controller, interactive: false)
            .background(Color.black)
            .ignoresSafeArea()
            .statusBarHidden()
    }
}

/// Puts the slides on an external display. SwiftUI apps without a scene manifest still receive a
/// `UIWindowScene` for a non-interactive external display; we give it our own window and hosting
/// controller. If the system mirrors instead (no such scene), the device screen is mirrored, which
/// still shows the presentation full screen.
@MainActor
final class PresentationExternalDisplay {
    static let shared = PresentationExternalDisplay()
    private var window: UIWindow?
    private weak var controller: PresentationController?
    private var observers: [NSObjectProtocol] = []

    func start(_ controller: PresentationController) {
        self.controller = controller
        if observers.isEmpty {
            let center = NotificationCenter.default
            observers.append(center.addObserver(forName: UIScene.willConnectNotification, object: nil, queue: .main) { [weak self] note in
                MainActor.assumeIsolated {
                    if let scene = note.object as? UIWindowScene { self?.attach(scene) }
                }
            })
            observers.append(center.addObserver(forName: UIScene.didDisconnectNotification, object: nil, queue: .main) { [weak self] note in
                MainActor.assumeIsolated {
                    guard let self, let scene = note.object as? UIWindowScene, self.window?.windowScene === scene else { return }
                    self.detach()
                }
            })
        }
        for scene in UIApplication.shared.connectedScenes {
            if let windowScene = scene as? UIWindowScene { attach(windowScene) }
        }
    }

    func stop() {
        detach()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        controller = nil
    }

    private func attach(_ scene: UIWindowScene) {
        guard scene.session.role == .windowExternalDisplayNonInteractive, window == nil, let controller else { return }
        let window = UIWindow(windowScene: scene)
        let host = UIHostingController(rootView: PresentationExternalView(controller: controller))
        host.view.backgroundColor = .black
        window.rootViewController = host
        window.windowLevel = .normal + 1
        window.isHidden = false
        self.window = window
        controller.externalConnected = true
    }

    private func detach() {
        window?.isHidden = true
        window = nil
        controller?.externalConnected = false
    }
}
