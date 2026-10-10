import PDFKit
import SwiftUI

/// Loads a PDF for a picker sheet, keeping security-scoped access while shown.
@MainActor
@Observable
final class PagesPickerDocument {
    var document: PDFDocument?
    var failed = false
    private var scopedURL: URL?

    func load(_ url: URL, password: String?) {
        guard document == nil else { return }
        if url.startAccessingSecurityScopedResource() { scopedURL = url }
        guard let pdf = PDFDocument(url: url) else { failed = true; return }
        if pdf.isLocked, !(password.map(pdf.unlock(withPassword:)) ?? false) { failed = true; return }
        document = pdf
    }

    func release() {
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = nil
    }
}

/// Thumbnail grid of a document's pages used by the page pickers.
struct PagesPickerGrid<Badge: View>: View {
    let document: PDFDocument
    let isActive: (Int) -> Bool
    var dimInactive = true
    let labelOf: (Int) -> String
    let onPress: (Int) -> Void
    @ViewBuilder var badge: (Int) -> Badge

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 12)], spacing: 14) {
            ForEach(1...max(1, document.pageCount), id: \.self) { page in
                let active = isActive(page)
                Button { onPress(page) } label: {
                    VStack(spacing: 4) {
                        ZStack(alignment: .topLeading) {
                            PageThumbnail(page: document.page(at: page - 1), width: 96)
                                .opacity(dimInactive && !active ? 0.45 : 1)
                                .padding(3)
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(active ? Palette.primary : Color.clear, lineWidth: 2.5))
                            badge(page)
                        }
                        Text("\(page)").font(.caption.monospacedDigit()).foregroundStyle(active ? Palette.primary : Palette.mutedForeground)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(labelOf(page))
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
    }
}

/// Choose pages on thumbnails (`PagePickerDialog`): tap toggles, range mode fills from the last tap.
struct PagePickerSheet: View {
    enum Preset: String, CaseIterable { case all, none, odd, even, invert }

    let title: String
    let url: URL
    let password: String?
    let ranges: String
    let onApply: ([Int]) -> Void
    @State private var loader = PagesPickerDocument()
    @State private var selected: Set<Int> = []
    @State private var anchor: Int?
    @State private var rangeMode = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let document = loader.document {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            presets(document.pageCount)
                            Text(t("tools.pagePicker.hint")).font(.caption).foregroundStyle(Palette.mutedForeground)
                                .fixedSize(horizontal: false, vertical: true)
                            PagesPickerGrid(document: document, isActive: { selected.contains($0) }, labelOf: { t("tools.pagePicker.page", ["page": $0]) },
                                       onPress: press) { page in
                                if selected.contains(page) {
                                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Palette.primaryForeground, Palette.primary).padding(6)
                                }
                            }
                        }
                        .padding()
                    }
                } else if loader.failed {
                    EmptyStateView(symbol: "exclamationmark.triangle", title: t("errors.INVALID_PDF"))
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("tools.pagePicker.apply", ["count": selected.count])) {
                        onApply(selected.sorted())
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            loader.load(url, password: password)
            if let document = loader.document {
                let count = document.pageCount
                selected = Set(PagesSpecs.rangePages(ranges, pageCount: count) ?? Array(1...max(1, count)))
            }
        }
        .onDisappear { loader.release() }
    }

    private func presets(_ total: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Preset.allCases, id: \.self) { preset in
                        Button(t("tools.pagePicker.presets.\(preset.rawValue)")) { apply(preset, total: total) }.buttonStyle(.bordered)
                    }
                    Toggle(isOn: $rangeMode) { Label(t("tools.pages.range.title"), systemImage: "arrow.left.and.right.text.vertical") }
                        .toggleStyle(.button)
                        .buttonStyle(.bordered)
                }
            }
            Text(t("tools.pagePicker.count", ["count": selected.count, "total": total])).font(.subheadline).foregroundStyle(Palette.mutedForeground)
        }
    }

    private func press(_ page: Int) {
        if rangeMode, let anchor {
            let on = selected.contains(anchor)
            for value in min(anchor, page)...max(anchor, page) { if on { selected.insert(value) } else { selected.remove(value) } }
        } else {
            if selected.contains(page) { selected.remove(page) } else { selected.insert(page) }
            anchor = page
        }
    }

    private func apply(_ preset: Preset, total: Int) {
        let all = Set(1...max(1, total))
        switch preset {
        case .all: selected = all
        case .none: selected = []
        case .odd: selected = all.filter { $0 % 2 == 1 }
        case .even: selected = all.filter { $0 % 2 == 0 }
        case .invert: selected = all.subtracting(selected)
        }
    }
}

/// Choose where each split part starts (`CutPickerDialog`).
struct CutPickerSheet: View {
    let url: URL
    let password: String?
    let ranges: String
    let onApply: (String) -> Void
    @State private var loader = PagesPickerDocument()
    @State private var starts: Set<Int> = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let document = loader.document {
                    let sorted = starts.sorted()
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(t("tools.split.cuts.hint")).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                            HStack {
                                Text(t("tools.split.cuts.count", ["count": sorted.count + 1])).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                                Spacer()
                                Button(t("tools.split.cuts.clear")) { starts = [] }.buttonStyle(.bordered).disabled(starts.isEmpty)
                            }
                            PagesPickerGrid(document: document, isActive: { starts.contains($0) }, dimInactive: false, labelOf: { page in
                                page == 1 ? t("tools.split.cuts.firstPage") : (starts.contains(page) ? t("tools.split.cuts.removeCut", ["page": page]) : t("tools.split.cuts.addCut", ["page": page]))
                            }, onPress: { page in
                                guard page > 1 else { return }
                                if starts.contains(page) { starts.remove(page) } else { starts.insert(page) }
                            }) { page in
                                if page == 1 || starts.contains(page) {
                                    HStack(spacing: 3) {
                                        if page > 1 { Image(systemName: "scissors") }
                                        Text("\(sorted.filter { $0 <= page }.count + 1)")
                                    }
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(Palette.primary, in: RoundedRectangle(cornerRadius: 5))
                                    .foregroundStyle(Palette.primaryForeground)
                                    .padding(8)
                                }
                            }
                        }
                        .padding()
                    }
                } else if loader.failed {
                    EmptyStateView(symbol: "exclamationmark.triangle", title: t("errors.INVALID_PDF"))
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(t("tools.split.cuts.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("tools.split.cuts.apply", ["count": starts.count + 1])) {
                        onApply(PagesSpecs.cutsToRanges(Array(starts), pageCount: loader.document?.pageCount ?? 1))
                        dismiss()
                    }
                    .disabled(starts.isEmpty)
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            loader.load(url, password: password)
            if let count = loader.document?.pageCount { starts = Set(PagesSpecs.rangesToCuts(ranges, pageCount: count)) }
        }
        .onDisappear { loader.release() }
    }
}
