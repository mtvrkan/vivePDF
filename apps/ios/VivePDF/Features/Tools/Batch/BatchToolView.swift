import SwiftUI

// Placeholder until the module is ported.
struct BatchToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.batch"))
            .navigationTitle(t("nav.batch"))
    }
}
