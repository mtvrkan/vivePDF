import SwiftUI

// Form controls of the CV builder (`cv/fields/*`): labelled fields with soft validation, multi-line
// text, level dots and the month/year picker.

enum StudioCVCheck: String {
    case email, url, phone

    func accepts(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        switch self {
        case .email: return trimmed.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
        case .url: return trimmed.range(of: "^(https?://)?([\\p{L}\\p{N}-]+\\.)+[\\p{L}]{2,}(:\\d+)?([/?#]\\S*)?$", options: [.regularExpression, .caseInsensitive]) != nil
        case .phone: return trimmed.range(of: "^\\+?[\\d\\s().-]+$", options: .regularExpression) != nil && trimmed.filter(\.isNumber).count >= 7
        }
    }

    static func of(_ kind: StudioCVContactKind) -> StudioCVCheck? {
        switch kind {
        case .email: .email
        case .phone: .phone
        case .website, .linkedin, .github: .url
        default: nil
        }
    }
}

struct StudioCVTextField: View {
    let label: String
    @Binding var value: String
    var max = 200
    var placeholder: String? = nil
    var hint: String? = nil
    var check: StudioCVCheck? = nil
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    @FocusState private var focused: Bool
    @State private var touched = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(Palette.mutedForeground)
            TextField(placeholder ?? "", text: Binding(get: { value }, set: { value = String($0.prefix(max)) }))
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .autocorrectionDisabled(check != nil)
                .textInputAutocapitalization(check != nil ? .never : .sentences)
                .focused($focused)
                .onChange(of: focused) { _, now in if !now { touched = true } }
                .accessibilityLabel(label)
            if let check, touched, !check.accepts(value) {
                Text(t("studio.cv.checks.\(check.rawValue)")).font(.caption).foregroundStyle(Palette.warning)
            } else if let hint {
                Text(hint).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct StudioCVParagraphField: View {
    let label: String
    @Binding var value: String
    var placeholder: String? = nil
    var hint: String? = nil
    var minLines = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(Palette.mutedForeground)
            TextField(placeholder ?? "", text: Binding(get: { value }, set: { value = String($0.prefix(StudioCVLimits.textLimit)) }), axis: .vertical)
                .lineLimit(minLines...12)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(label)
            if let hint {
                Text(hint).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Five dots; tapping the current level clears it (`LevelPicker`).
struct StudioCVLevelPicker: View {
    let label: String
    let value: Int
    let labels: [String]
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...StudioCVLimits.maxLevel, id: \.self) { level in
                Button { onChange(value == level ? 0 : level) } label: {
                    Circle()
                        .fill(level <= value ? Palette.primary : Color.clear)
                        .overlay(Circle().strokeBorder(level <= value ? Palette.primary : Palette.mutedForeground.opacity(0.5)))
                        .frame(width: 16, height: 16)
                        .frame(width: 30, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(labels.indices.contains(level - 1) ? labels[level - 1] : "\(level)")
                .accessibilityAddTraits(value == level ? .isSelected : [])
            }
            Text(value > 0 && labels.indices.contains(value - 1) ? labels[value - 1] : t("studio.cv.noLevel"))
                .font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                .padding(.leading, 4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// Month menu + year field, or free typing (`MonthYearField`).
struct StudioCVMonthYearField: View {
    let label: String
    @Binding var value: String
    let language: String
    var disabled = false
    @State private var typing = false
    @State private var yearDraft = ""
    @State private var month: Int?

    private var parsed: StudioCVDates.MonthYear? { StudioCVDates.parse(value, language: language) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(Palette.mutedForeground)
            HStack(spacing: 6) {
                if typing {
                    TextField("", text: Binding(get: { value }, set: { value = String($0.prefix(40)) }))
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(label)
                    Button { typing = false } label: { Image(systemName: "calendar") }
                        .accessibilityLabel(t("studio.cv.dates.pick"))
                } else {
                    Menu {
                        Button(t("studio.cv.dates.noMonth")) { setMonth(nil) }
                        ForEach(Array(StudioCVDates.monthNames(language, long: true).enumerated()), id: \.offset) { index, name in
                            Button(name) { setMonth(index + 1) }
                        }
                    } label: {
                        Text(month.map { StudioCVDates.monthNames(language, long: true)[$0 - 1] } ?? t("studio.cv.dates.noMonth"))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .frame(minHeight: 34)
                            .background(Palette.muted, in: RoundedRectangle(cornerRadius: 6))
                    }
                    .accessibilityLabel(t("studio.cv.dates.month", ["name": label]))
                    TextField("2024", text: Binding(get: { yearDraft }, set: { text in
                        yearDraft = String(text.filter(\.isNumber).prefix(4))
                        write(month, yearDraft)
                    }))
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 72)
                    .monospacedDigit()
                    .accessibilityLabel(t("studio.cv.dates.year", ["name": label]))
                    Button { typing = true } label: { Image(systemName: "character.cursor.ibeam") }
                        .accessibilityLabel(t("studio.cv.dates.type"))
                }
            }
            .disabled(disabled)
        }
        .onAppear(perform: sync)
        .onChange(of: value) { _, _ in sync() }
    }

    private func sync() {
        if let parsed {
            yearDraft = String(parsed.year)
            month = parsed.month
        } else if !value.trimmingCharacters(in: .whitespaces).isEmpty {
            typing = true
        } else {
            yearDraft = ""
            month = nil
        }
    }

    private func setMonth(_ next: Int?) {
        month = next
        write(next, yearDraft)
    }

    private func write(_ nextMonth: Int?, _ yearText: String) {
        if yearText.count == 4, let year = Int(yearText), (1900...2100).contains(year) {
            value = StudioCVDates.format(StudioCVDates.MonthYear(month: nextMonth, year: year), language: language)
        } else if yearText.trimmingCharacters(in: .whitespaces).isEmpty && nextMonth == nil {
            value = ""
        }
    }
}

/// Header of a form section: title, count, add and show/hide (`FormSection`).
struct StudioCVSectionHeader: View {
    let title: String
    var count: Int? = nil
    var section: StudioCVSection? = nil
    var addLabel: String? = nil
    var addDisabled = false
    var onAdd: (() -> Void)? = nil
    @Environment(StudioCVStore.self) private var store

    var body: some View {
        let hidden = section.map { store.profile.hidden.contains($0) } ?? false
        HStack(spacing: 8) {
            Text(title).strikethrough(hidden).foregroundStyle(hidden ? Palette.mutedForeground : Palette.foreground)
                .font(.subheadline.weight(.semibold))
                .textCase(nil)
            if let count, count > 0 { Text("\(count)").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground) }
            Spacer(minLength: 4)
            if let onAdd, let addLabel {
                Button(action: onAdd) { Image(systemName: "plus.circle.fill").font(.title3) }
                    .disabled(addDisabled)
                    .accessibilityLabel(addLabel)
                    .buttonStyle(.borderless)
            }
            if let section {
                Button {
                    store.updateProfile { p in
                        if let i = p.hidden.firstIndex(of: section) { p.hidden.remove(at: i) } else { p.hidden.append(section) }
                    }
                } label: { Image(systemName: hidden ? "eye.slash" : "eye").font(.body) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(hidden ? t("studio.cv.showSection", ["name": title]) : t("studio.cv.hideSection", ["name": title]))
            }
        }
        .frame(minHeight: 32)
    }
}
