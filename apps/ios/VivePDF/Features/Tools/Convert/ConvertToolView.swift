import SwiftUI

// Placeholder until the module is ported.
struct ConvertToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.convert"))
            .navigationTitle(t("nav.convert"))
    }
}
