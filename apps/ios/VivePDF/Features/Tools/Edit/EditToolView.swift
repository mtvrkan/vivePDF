import SwiftUI

// Placeholder until the module is ported.
struct EditToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.edit"))
            .navigationTitle(t("nav.edit"))
    }
}
