import SwiftUI

// Placeholder until the module is ported.
struct ScanToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.scan"))
            .navigationTitle(t("nav.scan"))
    }
}
