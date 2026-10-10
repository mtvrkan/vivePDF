import SwiftUI

// Placeholder until the module is ported.
struct PageToolsView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("tools.grid.organizer"))
            .navigationTitle(t("tools.grid.organizer"))
    }
}
