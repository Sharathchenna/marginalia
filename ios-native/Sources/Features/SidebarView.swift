import SwiftUI

// The navigation sidebar — native mirror of Sidebar.tsx. Filters jump to the
// library with that filter applied; the lower groups switch screens.
struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @State private var showNewCollection = false
    @State private var newCollectionName = ""
    @State private var renameId: String?
    @State private var renameText = ""

    private func isFilter(_ f: String) -> Bool { model.filter == f && model.screen == .library }

    var body: some View {
        @Bindable var model = model
        let counts = model.counts

        List {
            Section {
                navRow("Home", "house", active: model.screen == .dashboard) { model.goScreen(.dashboard) }
                navRow("Inbox", "tray", active: isFilter("queue"), count: counts.queue) { model.pickFilter("queue") }
                navRow("All Papers", "books.vertical", active: isFilter("all"), count: counts.all) { model.pickFilter("all") }
                navRow("Favorites", "star", active: isFilter("fav"), count: counts.fav) { model.pickFilter("fav") }
                navRow("Unread", "circle", active: isFilter("unread"), count: counts.unread) { model.pickFilter("unread") }
            }

            Section("Read") {
                navRow("Bookmarks", "bookmark", active: isFilter("bookmarks"), count: counts.bookmarks) { model.pickFilter("bookmarks") }
                navRow("Blog Feeds", "dot.radiowaves.up.forward", active: model.screen == .feeds, count: counts.feedsUnread) { model.goScreen(.feeds) }
                if counts.archived > 0 {
                    navRow("Archive", "clock", active: isFilter("archived"), count: counts.archived) { model.pickFilter("archived") }
                }
            }

            if !model.collections.isEmpty {
                Section("Collections") {
                    ForEach(model.collections) { c in
                        Button { model.pickFilter(c.id) } label: {
                            HStack {
                                Circle().fill(Color(hex: c.color)).frame(width: 9, height: 9)
                                Text(c.name)
                                Spacer()
                                Text("\(c.ids.count)").foregroundStyle(.secondary).font(.footnote)
                            }
                        }
                        .listRowBackground(isFilter(c.id) ? Color.accentColor.opacity(0.15) : nil)
                        .swipeActions {
                            Button(role: .destructive) { model.deleteCollection(c.id) } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { renameId = c.id; renameText = c.name } label: {
                                Label("Rename", systemImage: "pencil")
                            }.tint(.orange)
                        }
                    }
                }
            }

            if !model.topTags.isEmpty {
                Section("Top tags") {
                    ForEach(model.topTags, id: \.self) { t in
                        navRow(t, "tag", active: isFilter("tag:" + t)) { model.pickFilter("tag:" + t) }
                    }
                }
            }

            Section("More") {
                navRow("Notebook", "book", active: model.screen == .notebook) { model.goScreen(.notebook) }
                navRow("Flashcards", "rectangle.on.rectangle", active: model.screen == .flashcards) { model.goScreen(.flashcards) }
                navRow("Daily Review", "clock.arrow.circlepath", active: model.screen == .review) { model.goScreen(.review) }
                navRow("Connections", "point.3.connected.trianglepath.dotted", active: model.screen == .graph) { model.goScreen(.graph) }
                navRow("Discover", "magnifyingglass", active: model.screen == .discover) { model.goScreen(.discover) }
                navRow("Settings", "gearshape", active: model.screen == .settings) { model.goScreen(.settings) }
            }
        }
        .navigationTitle("Marginalia")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNewCollection = true } label: { Image(systemName: "folder.badge.plus") }
            }
        }
        .alert("New collection", isPresented: $showNewCollection) {
            TextField("Name", text: $newCollectionName)
            Button("Create") {
                let n = newCollectionName.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { model.createCollection(n) }
                newCollectionName = ""
            }
            Button("Cancel", role: .cancel) { newCollectionName = "" }
        }
        .alert("Rename collection", isPresented: Binding(get: { renameId != nil }, set: { if !$0 { renameId = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") {
                if let id = renameId {
                    let n = renameText.trimmingCharacters(in: .whitespaces)
                    if !n.isEmpty { model.renameCollection(id, n) }
                }
                renameId = nil
            }
            Button("Cancel", role: .cancel) { renameId = nil }
        }
    }

    @ViewBuilder
    private func navRow(_ title: String, _ icon: String, active: Bool, count: Int = 0, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                if count > 0 { Text("\(count)").foregroundStyle(.secondary).font(.footnote) }
            }
        }
        .listRowBackground(active ? Color.accentColor.opacity(0.15) : nil)
    }
}

// Hex color helper used across the app for collection dots and highlight colors.
extension Color {
    init(hex: String) {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let r, g, b, a: Double
        switch s.count {
        case 8: r = Double((v >> 24) & 0xFF)/255; g = Double((v >> 16) & 0xFF)/255; b = Double((v >> 8) & 0xFF)/255; a = Double(v & 0xFF)/255
        case 6: r = Double((v >> 16) & 0xFF)/255; g = Double((v >> 8) & 0xFF)/255; b = Double(v & 0xFF)/255; a = 1
        default: r = 0.5; g = 0.5; b = 0.5; a = 1
        }
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
