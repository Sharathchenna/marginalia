import SwiftUI

// Left column: top-level screens (Home/Discover/Feeds/…) + library filters +
// collections + tags. A single selection token drives both: "screen:<case>" for a
// screen, or a raw filter string for the library.
struct MacSidebarView: View {
    @Environment(AppModel.self) private var model
    @State private var newCollection = ""
    @State private var showNewCollection = false

    private var selection: Binding<String?> {
        Binding(
            get: { model.screen == .library ? model.filter : "screen:\(model.screen.rawValue)" },
            set: { token in
                guard let token else { return }
                if token.hasPrefix("screen:"), let s = Screen(rawValue: String(token.dropFirst(7))) {
                    model.goScreen(s)
                } else {
                    model.pickFilter(token)
                }
            }
        )
    }

    var body: some View {
        List(selection: selection) {
            Section("Browse") {
                screenRow(.dashboard, "Home", "house")
                screenRow(.discover, "Discover", "sparkle.magnifyingglass")
                screenRow(.feeds, "Feeds", "dot.radiowaves.up.forward", model.counts.feedsUnread)
                screenRow(.notebook, "Notebook", "note.text")
                screenRow(.flashcards, "Flashcards", "rectangle.stack")
                screenRow(.review, "Daily Review", "calendar", SRS.dueCount(model.papers))
                screenRow(.graph, "Connections", "point.3.connected.trianglepath.dotted")
            }

            Section("Library") {
                filterRow("all", "All Papers", "tray.full", model.counts.all)
                filterRow("queue", "Reading Queue", "books.vertical", model.counts.queue)
                filterRow("unread", "Unread", "circle", model.counts.unread)
                filterRow("fav", "Favorites", "star", model.counts.fav)
                filterRow("bookmarks", "Bookmarks", "bookmark", model.counts.bookmarks)
                filterRow("archived", "Archived", "archivebox", model.counts.archived)
            }

            if !model.collections.isEmpty {
                Section("Collections") {
                    ForEach(model.collections) { c in
                        Label(c.name.isEmpty ? "Untitled" : c.name, systemImage: "folder")
                            .badge(model.collectionCount(c.id))
                            .tag(c.id)
                            .contextMenu {
                                Button("Delete", role: .destructive) { model.deleteCollection(c.id) }
                            }
                    }
                }
            }

            if !model.topTags.isEmpty {
                Section("Tags") {
                    ForEach(model.topTags, id: \.self) { t in
                        Label(t, systemImage: "tag").tag("tag:\(t)")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            Button { showNewCollection = true } label: {
                Label("New Collection", systemImage: "plus").font(.callout)
            }
            .buttonStyle(.plain).padding(8)
        }
        .alert("New Collection", isPresented: $showNewCollection) {
            TextField("Name", text: $newCollection)
            Button("Create") {
                let n = newCollection.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { model.createCollection(n) }
                newCollection = ""
            }
            Button("Cancel", role: .cancel) { newCollection = "" }
        }
    }

    private func screenRow(_ s: Screen, _ title: String, _ icon: String, _ count: Int = 0) -> some View {
        Label(title, systemImage: icon)
            .badge(count)
            .tag("screen:\(s.rawValue)")
    }
    private func filterRow(_ id: String, _ title: String, _ icon: String, _ count: Int) -> some View {
        Label(title, systemImage: icon)
            .badge(count)
            .tag(id)
    }
}
