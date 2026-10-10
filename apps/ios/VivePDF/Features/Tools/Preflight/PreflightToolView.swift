import SwiftUI

// Placeholder until the module is ported.
struct PreflightToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.preflight"))
            .navigationTitle(t("nav.preflight"))
    }
}
