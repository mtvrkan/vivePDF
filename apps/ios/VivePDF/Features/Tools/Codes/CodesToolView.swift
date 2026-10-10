import SwiftUI

// Placeholder until the module is ported.
struct CodesToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.codes"))
            .navigationTitle(t("nav.codes"))
    }
}
