import SwiftUI

// macOS entry point. Shares the AppModel state hub + all the Foundation-only Core
// (Models / Common services / Data) with the iOS app; the UI below is desktop-native
// (NavigationSplitView, Table, PDFKit via NSViewRepresentable, a Settings scene).
@main
struct MarginaliaMacApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            MacRootView()
                .environment(model)
                .frame(minWidth: 940, minHeight: 580)
        }
        .commands {
            SidebarCommands()
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .sidebar) {
                Button("Sync Now") { Task { await model.syncNow() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }

        // Qualify the scene: our app-model `Settings` struct (Models.swift) shadows
        // SwiftUI's `Settings` scene type otherwise.
        SwiftUI.Settings {
            MacSettingsView()
                .environment(model)
                .frame(width: 500, height: 380)
        }
    }
}
