import SwiftUI

// Placeholder until the module is ported.
struct CreateToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.create"))
            .navigationTitle(t("nav.create"))
    }
}
