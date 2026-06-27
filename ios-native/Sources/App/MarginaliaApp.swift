import SwiftUI

@main
struct MarginaliaApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(model.settings.theme == "dark" ? .dark : .light)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        // On iPhone, picking a sidebar item flips this to .detail so the list/reader
        // shows; the back button flips it back. On iPad both columns are visible.
        let column = Binding<NavigationSplitViewColumn>(
            get: { model.preferredColumnDetail ? .detail : .sidebar },
            set: { model.preferredColumnDetail = ($0 == .detail) }
        )
        NavigationSplitView(preferredCompactColumn: column) {
            SidebarView()
        } detail: {
            NavigationStack(path: $model.navPath) {
                DetailColumn()
                    .navigationDestination(for: Paper.self) { p in
                        ReaderView(paperId: p.id)
                    }
            }
        }
        .task {
            if let pid = model.pendingOpen, let p = model.paper(pid) {
                model.navPath = [p]
                model.pendingOpen = nil
            }
            // Dev hook: MARG_SYNC_TEST=1 + MARG_WEBDAV=<url> exercises encrypted sync.
            if ProcessInfo.processInfo.environment["MARG_SYNC_TEST"] == "1",
               let dav = ProcessInfo.processInfo.environment["MARG_WEBDAV"] {
                model.settings.webdavUrl = dav
                model.settings.syncPassphrase = "test-pass"
                await model.syncNow()
                if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    try? (model.syncStatus ?? "nil").write(to: dir.appendingPathComponent("sync.txt"), atomically: true, encoding: .utf8)
                }
            }
            // Dev hook: MARG_LOOKUP=<id> exercises the live lookup + parser, writing
            // the result to Documents/lookup.txt (read via simctl get_app_container).
            if let q = ProcessInfo.processInfo.environment["MARG_LOOKUP"] {
                var out = ""
                do {
                    let p = try await LookupService.lookup(q)
                    out = "LOOKUP_OK :: \(p.title) :: \(p.authors) :: \(p.year) :: \(p.venue) :: doi=\(p.doi)"
                } catch {
                    out = "LOOKUP_ERR :: \(error.localizedDescription)"
                }
                if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    try? out.write(to: dir.appendingPathComponent("lookup.txt"), atomically: true, encoding: .utf8)
                }
            }
        }
    }
}

// Routes the current screen to its view. The library is the default surface; the
// sidebar swaps `model.screen` for the other destinations.
struct DetailColumn: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.screen {
        case .library, .reader: LibraryView()
        case .settings: SettingsView()
        case .dashboard: DashboardView()
        case .feeds: FeedsView()
        case .flashcards: FlashcardsView()
        case .review: ReviewView()
        case .discover: DiscoverView()
        case .notebook: NotebookView()
        case .graph: GraphView()
        case .onboarding: PlaceholderScreen(title: "Welcome", systemImage: "sparkles")
        }
    }
}

struct PlaceholderScreen: View {
    let title: String
    let systemImage: String
    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text("Coming in a later phase."))
            .navigationTitle(title)
    }
}
