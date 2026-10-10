import SwiftUI

// Placeholder until the module is ported.
struct SignToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.sign"))
            .navigationTitle(t("nav.sign"))
    }
}
