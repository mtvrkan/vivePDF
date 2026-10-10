import SwiftUI

// Placeholder until the module is ported.
struct StudioView: View {
    var startWithCV: Bool = false
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.studio"))
            .navigationTitle(t("nav.studio"))
    }
}
