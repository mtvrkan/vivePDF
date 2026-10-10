import PDFKit
import SwiftUI

/// Signature fields and their state (desktop `SignaturesPanel` + `SignatureItem`). Integrity is checked
/// on device; certificate trust is left to the Sign › Verify tool.
struct SignaturesPanel: View {
    let session: ViewerSession
    @Environment(AppModel.self) private var app

    @State private var fields: [SignatureFieldInfo]?
    @State private var checking = false

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        List {
            if let fields {
                if fields.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(t("viewer.signatures.none"), systemImage: "signature").font(.headline)
                            Text(t("viewer.signatures.noneHint")).font(.callout).foregroundStyle(Palette.mutedForeground)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    if let summary = SignatureInspector.status(of: fields) {
                        Section {
                            Label(t(summary.messageKey), systemImage: summary.symbol)
                                .foregroundStyle(summary.color)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Section {
                        ForEach(fields) { field in item(field) }
                    } footer: {
                        PanelFootnote(text: t("ios.viewer.document.trustNotChecked"), symbol: "info.circle").padding(.top, 4)
                    }
                    Section {
                        Button { app.navigate(.tool(.sign, tab: "verify")) } label: {
                            Label(t("tools.sign.verify.title"), systemImage: "checkmark.seal")
                        }
                    }
                }
            } else {
                Section { HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 12) }
            }
        }
        .listStyle(.insetGrouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await check() } } label: { Label(t("viewer.signatures.recheck"), systemImage: "arrow.clockwise") }
                    .disabled(checking)
            }
        }
        .task(id: DocumentReloadKey(session)) { await check() }
    }

    private func item(_ field: SignatureFieldInfo) -> some View {
        let verdict = Verdict(field)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: verdict.symbol).foregroundStyle(verdict.color).font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(field.signer ?? field.fieldName).font(.headline).lineLimit(2)
                    if field.signer != nil {
                        Text(field.fieldName).font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                if let page = field.pageIndex {
                    Button { session.go(toPage: page) } label: {
                        Text(t("viewer.comments.pageShort", ["page": session.label(ofPage: page)])).font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .frame(minHeight: 44)
                    .accessibilityLabel(t("viewer.link.goToPage", ["page": session.label(ofPage: page)]))
                }
            }
            if !field.isSigned {
                detail(t("ios.viewer.document.unsignedField"))
            } else {
                if field.isTimestamp { detail(t("ios.viewer.document.timestamp")) }
                detail(integrityText(field), color: field.integrity == .broken ? Palette.destructive : nil)
                if field.certified {
                    detail(t("tools.sign.verify.certified", ["permission": t("tools.sign.sign.permissions.\(permissionKey(field.permission))")]))
                }
                if let date = field.signedAt { detail(DocumentFormat.date(date)) }
                if let reason = field.reason, !reason.isEmpty { detail("\(t("tools.sign.sign.reason")): \(reason)") }
                if let location = field.location, !location.isEmpty { detail("\(t("tools.sign.sign.location")): \(location)") }
                if let contact = field.contactInfo, !contact.isEmpty { detail("\(t("tools.sign.sign.contact")): \(contact)") }
                if field.coverage != .unknown { detail(t("tools.sign.verify.coverageLevels.\(field.coverage.rawValue)")) }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func detail(_ text: String, color: Color? = nil) -> some View {
        Text(text).font(.footnote).foregroundStyle(color ?? Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
    }

    private func integrityText(_ field: SignatureFieldInfo) -> String {
        switch field.integrity {
        case .intact: t("tools.sign.verify.intact")
        case .broken: t("tools.sign.verify.broken")
        case .unknown: t("ios.viewer.document.integrityUnknown")
        }
    }

    /// DocMDP level → desktop permission key (`tools.sign.sign.permissions.*`).
    private func permissionKey(_ level: Int?) -> String {
        switch level {
        case 1: "none"
        case 3: "annotations"
        default: "forms"
        }
    }

    private func check() async {
        checking = true
        defer { checking = false }
        let pdf = session.pdf
        let url = session.document.url
        // The file is read in place (security scope is held by the open document) to hash the signed ranges.
        fields = await Task.detached(priority: .userInitiated) { SignatureInspector.verifiedFields(in: pdf, fileURL: url) }.value
    }

    private struct Verdict {
        let symbol: String
        let color: Color

        init(_ field: SignatureFieldInfo) {
            if !field.isSigned {
                symbol = "signature"; color = Palette.mutedForeground
            } else if field.integrity == .broken {
                symbol = "xmark.shield.fill"; color = Palette.destructive
            } else {
                // Intact but trust unknown: the desktop's "untrusted" pen icon in warning colour.
                symbol = "exclamationmark.shield.fill"; color = Palette.warning
            }
        }
    }
}

extension SignaturesSummary {
    var symbol: String {
        switch self {
        case .valid: "checkmark.shield.fill"
        case .attention: "exclamationmark.shield.fill"
        case .invalid: "xmark.shield.fill"
        }
    }

    var color: Color {
        switch self {
        case .valid: Palette.success
        case .attention: Palette.warning
        case .invalid: Palette.destructive
        }
    }
}
