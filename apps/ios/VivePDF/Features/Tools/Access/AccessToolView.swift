import SwiftUI

// Placeholder until the module is ported.
struct AccessToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.access"))
            .navigationTitle(t("nav.access"))
    }
}
