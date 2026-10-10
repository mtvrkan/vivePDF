import PDFKit
import SwiftUI

/// Floating presenter bar (desktop `PresenterBar` in `ImmersiveBar.tsx`): slide navigation, tools,
/// style, drawing cleanup, blackout, overview, timer/clock, settings and exit. Scrolls horizontally on
/// narrow screens so every control stays reachable at any width and text size.
struct PresentationBar: View {
    @Bindable var controller: PresentationController
    @State private var confirmAnnotations = false
    @State private var pageInput = ""
    @FocusState private var pageFocused: Bool
    @AppStorage("vivepdf.presentation.transition") private var transitionRaw = SlideTransition.fade.rawValue
    @AppStorage("vivepdf.presentation.pencilOnly") private var pencilOnly = false

    var body: some View {
        HStack(spacing: 4) {
            navigation
            divider
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    tools
                    divider
                    extras
                }
                .padding(.horizontal, 2)
            }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            divider
            barButton("arrow.down.right.and.arrow.up.left", t("viewer.exitFullscreen")) { controller.end() }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
        .environment(\.colorScheme, .dark)
        .frame(maxWidth: 980)
        .alert(t("presentation.confirmAnnotationsTitle"), isPresented: $confirmAnnotations) {
            Button(t("common.cancel"), role: .cancel) {}
            Button(t("presentation.confirmAnnotationsAction")) { controller.prefs.annotationsMode = true }
        } message: {
            Text(t("presentation.confirmAnnotationsBody"))
        }
        .onAppear { pageInput = "\(controller.pageIndex + 1)" }
        .onChange(of: controller.pageIndex) { _, page in if !pageFocused { pageInput = "\(page + 1)" } }
    }

    private var divider: some View {
        Rectangle().fill(.white.opacity(0.18)).frame(width: 1, height: 22).padding(.horizontal, 2)
    }

    private func barButton(_ symbol: String, _ label: String, active: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .foregroundStyle(active ? Color.accentColor : .primary)
                .background(active ? Color.accentColor.opacity(0.2) : .clear, in: Circle())
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(label)
        .help(label)
    }

    // MARK: Navigation

    private var navigation: some View {
        HStack(spacing: 0) {
            barButton("chevron.backward", t("viewer.previousPage"), disabled: controller.pageIndex <= 0) { controller.previous() }
            HStack(spacing: 2) {
                TextField(t("viewer.pageNumber"), text: $pageInput)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.callout.monospacedDigit())
                    .frame(minWidth: 28, maxWidth: 48)
                    .focused($pageFocused)
                    .onSubmit(goToTypedPage)
                    .onChange(of: pageFocused) { _, focused in if !focused { goToTypedPage() } }
                    .accessibilityLabel(t("viewer.pageNumber"))
                Text("/ \(controller.pageCount)").font(.callout.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1).fixedSize()
            }
            barButton("chevron.forward", t("viewer.nextPage"), disabled: controller.pageIndex >= controller.pageCount - 1) { controller.next() }
        }
    }

    private func goToTypedPage() {
        if let page = Int(pageInput.trimmingCharacters(in: .whitespaces)), page >= 1, page <= controller.pageCount {
            controller.go(to: page - 1)
        }
        pageInput = "\(controller.pageIndex + 1)"
    }

    // MARK: Tools

    @ViewBuilder
    private var tools: some View {
        ForEach(PresentationTool.allCases) { tool in
            barButton(tool == .shape ? controller.prefs.shapeKind.symbol : tool.symbol, t(tool.labelKey), active: controller.tool == tool) {
                controller.toggle(tool)
                controller.showChrome()
            }
        }
        barButton("plus.magnifyingglass", t("presentation.areaZoom"), active: controller.areaZoomArmed || controller.zoomRect != nil) {
            if controller.zoomRect != nil { controller.zoomRect = nil } else { controller.areaZoomArmed.toggle() }
        }
        if controller.tool.hasStyleOptions {
            barButton("paintpalette", t("presentation.style"), active: controller.styleOpen) { controller.styleOpen.toggle() }
                .popover(isPresented: $controller.styleOpen) {
                    PresentationStyleControls(controller: controller)
                        .presentationCompactAdaptation(.popover)
                }
        }
        barButton("arrow.uturn.backward", t("tools.pages.undo"), disabled: !controller.canUndo) { controller.undo() }
        barButton("arrow.uturn.forward", t("tools.pages.redo"), disabled: !controller.canRedo) { controller.redoStroke() }
        if controller.tool == .select, controller.selectedID != nil {
            barButton("trash", t("presentation.deleteDrawing")) { controller.deleteSelected() }
        }
        Menu {
            Button(t("presentation.cleanup.page", ["count": controller.cleanupPageCount]), role: .destructive) { controller.clearVisible() }
                .disabled(controller.cleanupPageCount == 0)
            Button(t("presentation.cleanup.all", ["count": controller.cleanupTotalCount]), role: .destructive) { controller.clearAll() }
                .disabled(controller.cleanupTotalCount == 0)
        } label: {
            Image(systemName: "paintbrush")
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(t("presentation.cleanup.title"))
        .disabled(controller.cleanupTotalCount == 0 && controller.cleanupPageCount == 0)
    }

    // MARK: Extras

    @ViewBuilder
    private var extras: some View {
        barButton("moon.fill", t("presentation.blackoutBlack"), active: controller.blackout == .black) { controller.toggleBlackout(.black) }
        barButton("sun.max.fill", t("presentation.blackoutWhite"), active: controller.blackout == .white) { controller.toggleBlackout(.white) }
        barButton("square.grid.3x3", t("presentation.overview"), active: controller.overviewOpen) { controller.overviewOpen.toggle() }
        barButton("timer", t("presentation.toggleTimer"), active: controller.prefs.showTimer) { controller.prefs.showTimer.toggle() }
        barButton("clock", t("presentation.toggleClock"), active: controller.prefs.showClock) { controller.prefs.showClock.toggle() }
        Menu {
            Picker(t("ios.viewer.presentation.transition.title"), selection: $transitionRaw) {
                ForEach(SlideTransition.allCases) { Text(t($0.labelKey)).tag($0.rawValue) }
            }
            .pickerStyle(.menu)
            Toggle(t("ios.viewer.presentation.pencilOnly"), isOn: $pencilOnly)
            Toggle(t("presentation.saveAsAnnotations"), isOn: Binding(
                get: { controller.prefs.annotationsMode },
                set: { on in if on { confirmAnnotations = true } else { controller.prefs.annotationsMode = false } }
            ))
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(t("presentation.settings"))
    }
}

/// Tool style popover (desktop `PresentationStyleControls`).
struct PresentationStyleControls: View {
    @Bindable var controller: PresentationController

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(t("presentation.style")).font(.headline)
                switch controller.tool {
                case .laser: laser
                case .spotlight: spotlight
                case .magnifier: magnifier
                default: ink
                }
            }
            .padding(16)
            .frame(width: 300, alignment: .leading)
        }
        .frame(maxHeight: 460)
    }

    @ViewBuilder
    private var ink: some View {
        if controller.tool == .shape {
            Picker(t("presentation.shape"), selection: $controller.prefs.shapeKind) {
                ForEach(PresentationShape.allCases) { Label(t($0.labelKey), systemImage: $0.symbol).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        swatches(PresentationGeometry.penColors, selection: $controller.prefs.penColor)
        if controller.tool == .highlighter {
            slider(t("presentation.thickness"), value: $controller.prefs.highlighterWidth, range: PresentationGeometry.highlighterWidthRange, step: 1, unit: "pt")
        } else if controller.tool == .text {
            slider(t("presentation.textSize"), value: $controller.prefs.textSize, range: PresentationGeometry.textSizeRange, step: 1, unit: "pt")
        } else {
            slider(t("presentation.thickness"), value: $controller.prefs.penWidth, range: PresentationGeometry.penWidthRange, step: 1, unit: "pt")
        }
        if controller.tool == .pen || controller.tool == .shape {
            slider(t("presentation.opacity"), value: $controller.prefs.penOpacity, range: PresentationGeometry.opacityRange, step: 0.05, percent: true)
        }
    }

    @ViewBuilder
    private var laser: some View {
        swatches(PresentationGeometry.laserColors, selection: $controller.prefs.laserColor)
        choice(t("presentation.size"), options: PresentationGeometry.laserSizes, selection: $controller.prefs.laserSize)
    }

    @ViewBuilder
    private var spotlight: some View {
        choice(t("presentation.size"), options: PresentationGeometry.spotlightSizes, selection: $controller.prefs.spotlightRadius)
        choice(t("presentation.dim"), options: PresentationGeometry.spotlightDims, selection: $controller.prefs.spotlightDim, percent: true)
    }

    @ViewBuilder
    private var magnifier: some View {
        choice(t("presentation.size"), options: PresentationGeometry.magnifierSizes, selection: $controller.prefs.magnifierSize)
        choice(t("presentation.zoom"), options: PresentationGeometry.magnifierZooms, selection: $controller.prefs.magnifierZoom, suffix: "×")
    }

    private func swatches(_ colors: [String], selection: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 36), spacing: 8)], spacing: 8) {
                ForEach(colors, id: \.self) { hex in
                    let selected = hex.caseInsensitiveCompare(selection.wrappedValue) == .orderedSame
                    Button { selection.wrappedValue = hex } label: {
                        Circle().fill(StrokePainter.color(hex))
                            .frame(width: 30, height: 30)
                            .overlay(Circle().strokeBorder(selected ? Color.accentColor : .white.opacity(0.3), lineWidth: selected ? 3 : 1))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(hex)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            ColorPicker(t("presentation.customColor"), selection: Binding(
                get: { StrokePainter.color(selection.wrappedValue) },
                set: { color in
                    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                    UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
                    selection.wrappedValue = PresentationGeometry.hex(r: r, g: g, b: b)
                }
            ), supportsOpacity: false)
        }
    }

    private func slider(_ label: String, value: Binding<CGFloat>, range: ClosedRange<CGFloat>, step: CGFloat, unit: String = "", percent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(percent ? "\(Int((value.wrappedValue * 100).rounded()))%" : "\(Int(value.wrappedValue)) \(unit)")
                    .monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.subheadline)
            Slider(value: value, in: range, step: step)
                .accessibilityLabel(label)
        }
    }

    private func choice(_ label: String, options: [CGFloat], selection: Binding<CGFloat>, percent: Bool = false, suffix: String = "") -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline)
            Picker(label, selection: selection) {
                ForEach(options, id: \.self) { value in
                    Text(percent ? "\(Int((value * 100).rounded()))%" : (suffix.isEmpty ? "\(Int(value))" : "\(value.formatted())\(suffix)")).tag(value)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

/// Timer and clock chip (desktop `TimerClockChip`).
struct TimerClockChip: View {
    @Bindable var controller: PresentationController
    var large = false

    var body: some View {
        if controller.prefs.showClock || controller.prefs.showTimer || large {
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                HStack(spacing: 8) {
                    if controller.prefs.showClock || large {
                        Text(context.date, format: .dateTime.hour().minute())
                            .monospacedDigit()
                    }
                    if (controller.prefs.showClock || large) && (controller.prefs.showTimer || large) {
                        Rectangle().fill(.white.opacity(0.25)).frame(width: 1, height: 16)
                    }
                    if controller.prefs.showTimer || large {
                        Text(PresentationGeometry.formatElapsed(controller.timerValue))
                            .monospacedDigit()
                        Button { controller.toggleTimerRunning() } label: {
                            Image(systemName: controller.timerRunning ? "pause.fill" : "play.fill").frame(width: 36, height: 36)
                        }
                        .accessibilityLabel(t(controller.timerRunning ? "presentation.timerPause" : "presentation.timerStart"))
                        Button { controller.resetTimer() } label: {
                            Image(systemName: "arrow.counterclockwise").frame(width: 36, height: 36)
                        }
                        .accessibilityLabel(t("presentation.timerReset"))
                    }
                }
                .font(large ? .title2.weight(.semibold) : .callout.weight(.semibold))
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(.regularMaterial, in: Capsule())
                .environment(\.colorScheme, .dark)
            }
        }
    }
}

/// Slide overview grid (desktop `OverviewGrid`).
struct PresentationOverview: View {
    @Bindable var controller: PresentationController

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(t("presentation.overview")).font(.headline)
                Spacer()
                Button { controller.overviewOpen = false } label: {
                    Image(systemName: "xmark").frame(width: 44, height: 44)
                }
                .accessibilityLabel(t("common.close"))
            }
            .padding(.horizontal)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 18) {
                        ForEach(0..<controller.pageCount, id: \.self) { index in
                            Button {
                                controller.go(to: index)
                                controller.overviewOpen = false
                            } label: {
                                VStack(spacing: 6) {
                                    PageThumbnail(page: controller.session.pdf.page(at: index), width: 150)
                                        .overlay(RoundedRectangle(cornerRadius: 4)
                                            .strokeBorder(index == controller.pageIndex ? Color.accentColor : .clear, lineWidth: 3))
                                    Text(controller.session.label(ofPage: index)).font(.caption.monospacedDigit())
                                        .foregroundStyle(index == controller.pageIndex ? Color.accentColor : .secondary)
                                }
                            }
                            .buttonStyle(.plain)
                            .id(index)
                            .accessibilityLabel(t("ios.viewer.presentation.slide", ["page": index + 1, "total": controller.pageCount]))
                        }
                    }
                    .padding()
                }
                .onAppear { proxy.scrollTo(controller.pageIndex, anchor: .center) }
            }
        }
        .padding(.top, 8)
        .background(.ultraThinMaterial)
        .environment(\.colorScheme, .dark)
    }
}
