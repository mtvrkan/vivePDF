import SwiftUI

// Placeholder until the module is ported.
struct SecurityToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.security"))
            .navigationTitle(t("nav.security"))
    }
}
