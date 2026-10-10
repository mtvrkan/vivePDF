import SwiftUI

@main
struct VivePDFApp: App {
    @State private var app = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
        .commands { AppCommands(app: app) }
    }
}

/// Hardware-keyboard shortcuts on iPad (shown in the ⌘ overlay), matching the desktop menu.
struct AppCommands: Commands {
    let app: AppModel

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button(t("common.openPdf")) { app.showOpenPicker = true }
                .keyboardShortcut("o", modifiers: .command)
        }
        CommandMenu(t("nav.tools")) {
            Button(t("palette.title")) { app.showCommandPalette = true }
                .keyboardShortcut("k", modifiers: .command)
            Divider()
            Button(t("nav.home")) { app.navigate(.home) }.keyboardShortcut("1", modifiers: .command)
            Button(t("nav.viewer")) { app.navigate(.viewer) }.keyboardShortcut("2", modifiers: .command)
            Button(t("nav.pages")) { app.navigate(.pages) }.keyboardShortcut("3", modifiers: .command)
            Button(t("nav.studio")) { app.navigate(.studio()) }.keyboardShortcut("4", modifiers: .command)
            Button(t("nav.search")) { app.navigate(.search) }.keyboardShortcut("f", modifiers: [.command, .shift])
            Button(t("nav.settings")) { app.navigate(.settings()) }.keyboardShortcut(",", modifiers: .command)
        }
    }
}
