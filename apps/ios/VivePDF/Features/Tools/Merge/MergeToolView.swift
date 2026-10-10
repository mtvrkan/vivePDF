import SwiftUI

// Placeholder until the module is ported.
struct MergeToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.merge"))
            .navigationTitle(t("nav.merge"))
    }
}
