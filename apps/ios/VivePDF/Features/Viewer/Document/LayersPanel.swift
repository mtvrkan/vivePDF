import PDFKit
import SwiftUI

/// Optional content groups (desktop `LayersPanel`): the document's layer tree with visibility and locks.
/// PDFKit renders the document's default layer configuration and offers no layer API, so switching
/// layers needs a rewritten view copy (`LayerReader.canSwitch`); until then the list is read-only.
struct LayersPanel: View {
    let session: ViewerSession

    @State private var rows: [PDFLayerInfo]?

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        List {
            if let rows {
                if rows.allSatisfy(\.isLabel) {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(t("viewer.layers.none"), systemImage: "square.3.layers.3d").font(.headline)
                            Text(t("viewer.layers.noneHint")).font(.callout).foregroundStyle(Palette.mutedForeground)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    Section {
                        ForEach(rows) { row in layerRow(row) }
                    } footer: {
                        VStack(alignment: .leading, spacing: 6) {
                            PanelFootnote(text: t("viewer.layers.hint"))
                            if !LayerReader.canSwitch {
                                PanelFootnote(text: t("ios.viewer.document.layersReadOnly"), symbol: "info.circle")
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            } else {
                Section { HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 12) }
            }
        }
        .listStyle(.insetGrouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { load() } label: { Label(t("viewer.layers.refresh"), systemImage: "arrow.clockwise") }
            }
        }
        .task(id: DocumentReloadKey(session)) { load() }
    }

    private func layerRow(_ row: PDFLayerInfo) -> some View {
        let name = row.name.isEmpty ? t("viewer.outline.untitled") : row.name
        return HStack(spacing: 10) {
            if row.isLabel {
                Text(name).font(.footnote.weight(.semibold)).foregroundStyle(Palette.mutedForeground).textCase(.uppercase)
            } else {
                Image(systemName: row.isOn ? "eye" : "eye.slash")
                    .foregroundStyle(row.isOn ? Palette.primary : Palette.mutedForeground)
                    .frame(width: 24)
                Text(name).foregroundStyle(row.isOn ? Palette.foreground : Palette.mutedForeground)
                Spacer(minLength: 4)
                if row.isLocked {
                    Image(systemName: "lock.fill").font(.caption).foregroundStyle(Palette.mutedForeground)
                        .accessibilityLabel(t("viewer.layers.locked"))
                }
            }
        }
        .padding(.leading, CGFloat(min(row.depth, 4)) * 16)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityValue(row.isLabel ? "" : (row.isOn ? t("common.yes") : t("common.no")))
        .help(row.isLocked ? t("viewer.layers.locked") : "")
    }

    private func load() {
        rows = LayerReader.layers(in: session.pdf)
    }
}
