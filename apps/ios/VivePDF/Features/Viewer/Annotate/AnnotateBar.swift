import PDFKit
import SwiftUI
import UIKit

/// The annotate / mark-up bar (desktop `AnnotateBar.tsx`), shown at the bottom of the viewer.
/// Regular width: tools and style controls inline. Compact width: tools scroll horizontally and the style
/// controls open in a sheet.
struct AnnotateBar: View {
    let session: ViewerSession
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showStyle = false
    @State private var confirmDeleteAll = false
    @State private var confirmOverwrite = false
    @State private var deleteAllCount = 0
    @State private var sharedCopy: URL?

    init(session: ViewerSession) {
        self.session = session
    }

    private var controller: AnnotationController { AnnotationController.of(session) }
    private var compact: Bool { sizeClass == .compact }

    var body: some View {
        let controller = controller
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 4) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        toolButton(.select).keyboardShortcut(.escape, modifiers: [])
                        toolButton(.area)
                        separator
                        ForEach(AnnotateTool.markupTools) { toolButton($0) }
                        separator
                        ForEach(AnnotateTool.drawTools) { toolButton($0) }
                        separator
                        ForEach(AnnotateTool.insertTools) { toolButton($0) }
                        separator
                        historyButtons(controller)
                    }
                    .padding(.horizontal, 8)
                }
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                trailingButtons(controller)
                    .padding(.trailing, 8)
            }
            .frame(minHeight: 50)
            if !compact {
                Divider()
                AnnotateStyleControls(controller: controller, layout: .inline)
                    .frame(minHeight: 44)
            }
        }
        .background(.bar)
        .sheet(isPresented: $showStyle) {
            NavigationStack {
                ScrollView {
                    AnnotateStyleControls(controller: controller, layout: .stacked)
                        .padding()
                }
                .navigationTitle(t("annotate.style"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { showStyle = false } }
                }
            }
            .presentationDetents([.medium, .large])
            .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .alert(t("annotate.deleteAllTitle"), isPresented: $confirmDeleteAll) {
            Button(t("common.cancel"), role: .cancel) {}
            Button(t("annotate.deleteAll"), role: .destructive) { controller.deleteAll() }
        } message: {
            Text(t("annotate.deleteAllBody", ["count": deleteAllCount, "name": session.document.fileName]))
        }
        .alert(t("annotate.overwriteTitle"), isPresented: $confirmOverwrite) {
            Button(t("common.cancel"), role: .cancel) {}
            Button(t("tools.overwrite"), role: .destructive) {
                controller.deselect()
                session.save()
            }
        } message: {
            Text(t("annotate.overwriteBody", ["name": session.document.fileName]))
        }
        .sheet(item: Binding(get: { sharedCopy.map(AnnotateSharedFile.init) }, set: { if $0 == nil { sharedCopy = nil } })) { file in
            AnnotateActivitySheet(items: [file.url])
                .presentationDetents([.medium, .large])
        }
        .onAppear { controller.refreshUndo() }
    }

    private var separator: some View {
        Divider().frame(height: 24).padding(.horizontal, 4)
    }

    private func toolButton(_ tool: AnnotateTool) -> some View {
        let controller = controller
        let active = controller.tool == tool || (tool == .select && controller.tool == nil)
        return Button {
            if tool == .select { controller.tool = .select } else { controller.selectTool(tool) }
        } label: {
            Image(systemName: tool.symbol)
                .font(.body.weight(active ? .semibold : .regular))
                .frame(width: 44, height: 44)
                .foregroundStyle(active ? Palette.primary : Palette.foreground)
                .background(active ? Palette.accent : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if tool.hasStyle && tool != .select {
                        Circle().fill(Color(uiColor: controller.style(for: tool).color))
                            .frame(width: 8, height: 8)
                            .overlay(Circle().strokeBorder(Palette.border))
                            .padding(6)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(t(tool.labelKey))
        .accessibilityAddTraits(active ? .isSelected : [])
        .help(t(tool.labelKey))
    }

    @ViewBuilder
    private func historyButtons(_ controller: AnnotationController) -> some View {
        iconButton("arrow.uturn.backward", t("tools.pages.undo"), disabled: !controller.canUndo) { controller.undo() }
            .keyboardShortcut("z", modifiers: .command)
        iconButton("arrow.uturn.forward", t("tools.pages.redo"), disabled: !controller.canRedo) { controller.redo() }
            .keyboardShortcut("z", modifiers: [.command, .shift])
        iconButton("trash", t("annotate.deleteSelected"), disabled: controller.selected.isEmpty) { controller.deleteSelected() }
            .keyboardShortcut(.delete, modifiers: [])
        iconButton("paintbrush.pointed", t("annotate.deleteAll"), disabled: false) {
            deleteAllCount = controller.allMarks().count
            if deleteAllCount > 0 { confirmDeleteAll = true }
        }
    }

    @ViewBuilder
    private func trailingButtons(_ controller: AnnotationController) -> some View {
        if compact {
            iconButton("paintpalette", t("annotate.style"), disabled: false) { showStyle = true }
        }
        Menu {
            Button {
                confirmOverwrite = true
            } label: { Label(t("annotate.save"), systemImage: "square.and.arrow.down") }
            Button {
                controller.deselect()
                sharedCopy = session.saveCopy()
            } label: { Label(t("annotate.saveAs"), systemImage: "square.and.arrow.down.on.square") }
        } label: {
            Image(systemName: "square.and.arrow.down")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(t("annotate.save"))
        iconButton("xmark", t("common.close"), disabled: false) {
            controller.disarm()
            session.showsAnnotate = false
        }
    }

    private func iconButton(_ symbol: String, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(disabled ? Palette.mutedForeground.opacity(0.5) : Palette.foreground)
        .disabled(disabled)
        .accessibilityLabel(label)
        .help(label)
    }
}

private struct AnnotateSharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// Style controls for new marks / the selected mark (desktop style row): colour, fill, width, dash,
/// line ends, curve, opacity, plus eraser size, stamp choice and Pencil-only drawing.
struct AnnotateStyleControls: View {
    enum Layout { case inline, stacked }
    let controller: AnnotationController
    let layout: Layout

    var body: some View {
        switch layout {
        case .inline:
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) { content }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
            }
        case .stacked:
            VStack(alignment: .leading, spacing: 16) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if controller.tool == .eraser {
            Text(t("annotate.eraserHint")).font(.footnote).foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: layout == .inline, vertical: layout == .stacked)
            labeled(t("annotate.eraserSize")) {
                Slider(value: Binding(get: { Double(controller.eraserSize) }, set: { controller.eraserSize = CGFloat($0) }),
                       in: Double(AnnotationController.minEraser)...Double(AnnotationController.maxEraser), step: 1)
                    .frame(minWidth: 120, maxWidth: layout == .inline ? 160 : .infinity)
                Text("\(Int(controller.eraserSize)) px").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            pencilToggle
        } else if let style = controller.currentStyle, let tool = controller.styleTool {
            if layout == .stacked {
                Text(header).font(.headline)
            }
            labeled(tool.showsFill ? t("annotate.stroke") : t("annotate.color")) {
                swatches(selected: style.color) { color in update { $0.color = color } }
            }
            if tool.showsFill {
                labeled(t("annotate.fill")) {
                    Button(style.fill == nil ? t("annotate.noFill") : t("annotate.filled")) {
                        update { $0.fill = $0.fill == nil ? $0.color : nil }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityAddTraits(style.fill != nil ? .isSelected : [])
                    if let fill = style.fill {
                        ColorPicker(t("annotate.fill"), selection: Binding(get: { Color(uiColor: fill) }, set: { color in update { $0.fill = UIColor(color) } }), supportsOpacity: false)
                            .labelsHidden()
                    }
                }
            }
            if tool.showsStroke {
                labeled(t("annotate.strokeWidth")) {
                    slider(value: Double(style.strokeWidth), range: Double(AnnotateStyle.minStrokeWidth)...Double(AnnotateStyle.maxStrokeWidth), step: Double(AnnotateStyle.strokeStep)) { value in
                        update { $0.strokeWidth = CGFloat(value) }
                    }
                    Text(String(format: "%g px", Double(style.strokeWidth))).font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                }
            }
            if tool.showsDash {
                Button(style.dashed ? t("annotate.dashed") : t("annotate.solid")) { update { $0.dashed.toggle() } }
                    .buttonStyle(.bordered)
                    .accessibilityAddTraits(style.dashed ? .isSelected : [])
            }
            if tool.showsEndings {
                labeled(t("annotate.ends")) {
                    endingPicker(t("annotate.endStart"), value: style.startEnding) { ending in update { $0.startEnding = ending } }
                    endingPicker(t("annotate.endEnd"), value: style.endEnding) { ending in update { $0.endEnding = ending } }
                }
            }
            if controller.selectedLine != nil {
                labeled(t("annotate.curve")) {
                    slider(value: controller.curve, range: AnnotationGeometry.minCurve...AnnotationGeometry.maxCurve, step: AnnotationGeometry.curveStep) { value in
                        controller.applyCurve(value)
                    }
                    Text("\(Int(controller.curve))").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                    Button(t("annotate.straighten")) { controller.applyCurve(0) }
                        .buttonStyle(.bordered)
                        .disabled(controller.curve == 0)
                }
            }
            labeled(t("annotate.opacity")) {
                slider(value: Double(style.opacity * 100), range: 0...100, step: 1) { value in update { $0.opacity = CGFloat(value / 100) } }
                Text("\(Int((style.opacity * 100).rounded()))%").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            if controller.tool == .stamp {
                labeled(t("viewer.comments.types.Stamp")) {
                    Picker(t("viewer.comments.types.Stamp"), selection: Binding(get: { controller.stamp }, set: { controller.stamp = $0 })) {
                        ForEach(AnnotateStamp.allCases) { stamp in
                            Text(stamp.text(author: AnnotationController.authorName)).tag(stamp)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            if let tool = controller.tool, [.ink, .square, .circle, .line, .arrow].contains(tool) { pencilToggle }
        } else {
            Text(t("annotate.styleHint")).font(.footnote).foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var header: String {
        if let tool = controller.tool, tool.hasStyle { return t("annotate.newMarks") }
        return controller.selected.count > 1 ? t("annotate.selectedMarks", ["count": controller.selected.count]) : t("annotate.selectedMark")
    }

    private var pencilToggle: some View {
        Toggle(isOn: Binding(get: { controller.pencilOnly }, set: { controller.pencilOnly = $0 })) {
            Label(t("ios.viewer.annotate.pencilOnly"), systemImage: "applepencil")
        }
        .toggleStyle(.button)
        .help(t("ios.viewer.annotate.pencilOnlyHint"))
    }

    private func update(_ change: (inout AnnotateStyle) -> Void) {
        guard var style = controller.currentStyle else { return }
        change(&style)
        controller.applyStyle(style)
    }

    @ViewBuilder
    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        switch layout {
        case .inline:
            HStack(spacing: 8) {
                Text(title).font(.caption).foregroundStyle(Palette.mutedForeground)
                content()
            }
        case .stacked:
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                HStack(spacing: 10) { content() }
            }
        }
    }

    private func slider(value: Double, range: ClosedRange<Double>, step: Double, onChange: @escaping (Double) -> Void) -> some View {
        Slider(value: Binding(get: { value }, set: onChange), in: range, step: step) { editing in
            if editing { controller.beginContinuousEdit() } else { controller.endContinuousEdit() }
        }
        .frame(minWidth: 110, maxWidth: layout == .inline ? 150 : .infinity)
    }

    private func swatches(selected: UIColor, onPick: @escaping (UIColor) -> Void) -> some View {
        HStack(spacing: 6) {
            ForEach(Array(AnnotateStyle.presets.enumerated()), id: \.offset) { index, hex in
                let color = UIColor(annotateHex: hex)
                let isOn = color.annotateMatches(selected)
                Button { onPick(color) } label: {
                    Circle().fill(Color(uiColor: color))
                        .frame(width: 22, height: 22)
                        .overlay(Circle().strokeBorder(isOn ? Palette.foreground : Palette.border, lineWidth: isOn ? 2 : 1))
                        .padding(4)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("annotate.colorSwatch", ["index": index + 1, "total": AnnotateStyle.presets.count, "value": hex]))
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
            ColorPicker(t("colorPicker.custom"), selection: Binding(get: { Color(uiColor: selected) }, set: { onPick(UIColor($0)) }), supportsOpacity: false)
                .labelsHidden()
                .accessibilityLabel(t("colorPicker.custom"))
        }
    }

    private func endingPicker(_ title: String, value: AnnotateLineEnding, onPick: @escaping (AnnotateLineEnding) -> Void) -> some View {
        Picker(title, selection: Binding(get: { value }, set: onPick)) {
            ForEach(AnnotateLineEnding.allCases) { ending in Text(t(ending.labelKey)).tag(ending) }
        }
        .pickerStyle(.menu)
        .accessibilityLabel(title)
    }
}

/// System share sheet for the saved copy.
struct AnnotateActivitySheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
