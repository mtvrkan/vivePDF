import SwiftUI

/// Large view of one tile with previous/next, rotate and select (`PagePreviewDialog`).
struct PagePreviewSheet: View {
    let model: OrganizerModel
    @State var key: String
    let onOpenInViewer: ((OrganizerTile) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        let position = model.position(of: key) ?? 0
        let tile = model.tiles.indices.contains(position) ? model.tiles[position] : nil
        NavigationStack {
            VStack(spacing: 12) {
                if let tile {
                    GeometryReader { proxy in
                        PagesTileThumbnail(tile: tile, model: model, box: proxy.size)
                            .id(tile.key + "\(tile.rotate)")
                    }
                    .padding(.horizontal)
                    .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        // Swiping towards the leading edge goes forward (mirrored in RTL by SwiftUI).
                        step(value.translation.width < 0 ? 1 : -1, extend: false)
                    })
                    controls(tile: tile, position: position)
                    Text(t("tools.pages.preview.hint"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
            .background(Palette.muted.opacity(0.4))
            .navigationTitle(t("tools.pages.preview.title", ["page": position + 1, "total": model.tiles.count]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onKeyPress(phases: .down) { press in handle(press) }
            .onAppear { focused = true }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private func controls(tile: OrganizerTile, position: Int) -> some View {
        let selected = model.selected.contains(tile.key)
        VStack(spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { selectButton(selected: selected, key: tile.key); navigation(position: position) }
                VStack(spacing: 10) { selectButton(selected: selected, key: tile.key); navigation(position: position) }
            }
            Text(origin(tile, position: position))
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal)
    }

    private func selectButton(selected: Bool, key: String) -> some View {
        Button { model.toggle(key) } label: {
            Label {
                VStack(alignment: .leading, spacing: 0) {
                    Text(t("tools.pages.preview.select"))
                    Text(t("tools.pages.selectedCount", ["count": model.selected.count])).font(.caption2).foregroundStyle(Palette.mutedForeground)
                }
            } icon: {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            }
        }
        .buttonStyle(.bordered)
        .tint(selected ? Palette.primary : .secondary)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func navigation(position: Int) -> some View {
        HStack(spacing: 6) {
            Button { step(-1, extend: false) } label: { Image(systemName: "chevron.backward") }
                .disabled(position == 0)
                .accessibilityLabel(t("tools.pages.preview.previous"))
            Button { step(1, extend: false) } label: { Image(systemName: "chevron.forward") }
                .disabled(position >= model.tiles.count - 1)
                .accessibilityLabel(t("tools.pages.preview.next"))
            Button { model.rotate(key, by: -90) } label: { Image(systemName: "rotate.left") }
                .accessibilityLabel(t("tools.pages.rotateLeft"))
            Button { model.rotate(key, by: 90) } label: { Image(systemName: "rotate.right") }
                .accessibilityLabel(t("tools.pages.rotateRight"))
            if let onOpenInViewer, let tile = model.tiles.first(where: { $0.key == key }), tile.sourceID == OrganizerOps.mainSourceID {
                Button { dismiss(); onOpenInViewer(tile) } label: { Image(systemName: "book") }
                    .accessibilityLabel(t("tools.pages.menu.openInViewer"))
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }

    private func origin(_ tile: OrganizerTile, position: Int) -> String {
        var text: String
        switch tile.kind {
        case .page(let source, let index):
            text = source == OrganizerOps.mainSourceID ? t("tools.pages.preview.originalPage", ["page": index]) : "\(model.source(source)?.fileName ?? "") · \(index)"
        case .blank(_, _, let paper):
            text = t(paper.map { "tools.pages.paper.\($0.style.rawValue)" } ?? "tools.pages.blank")
        case .image(let url):
            text = url.lastPathComponent
        }
        if let labels = model.labelTexts, labels.indices.contains(position) { text += " · " + t("tools.pages.labels.shown", ["label": labels[position]]) }
        if tile.rotate != 0 { text += " · \(tile.rotate)°" }
        return text
    }

    private func step(_ delta: Int, extend: Bool) {
        guard let position = model.position(of: key) else { return }
        let next = max(0, min(model.tiles.count - 1, position + delta))
        let nextKey = model.tiles[next].key
        if extend { model.selected.insert(key); model.selected.insert(nextKey) }
        key = nextKey
    }

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        switch press.key {
        case .leftArrow, .rightArrow:
            let forward = press.key == .rightArrow
            step(forward ? 1 : -1, extend: press.modifiers.contains(.shift))
            return .handled
        case .space, .escape:
            dismiss()
            return .handled
        case .return:
            model.toggle(key)
            return .handled
        default:
            if press.characters.lowercased() == "r" {
                model.rotate(key, by: press.modifiers.contains(.shift) ? -90 : 90)
                return .handled
            }
            return .ignored
        }
    }
}
