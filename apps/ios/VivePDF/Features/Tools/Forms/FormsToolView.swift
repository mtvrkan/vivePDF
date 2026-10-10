import SwiftUI

// Placeholder until the module is ported.
struct FormsToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.forms"))
            .navigationTitle(t("nav.forms"))
    }
}
