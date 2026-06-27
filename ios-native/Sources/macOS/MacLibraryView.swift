import SwiftUI

// Middle column: the filtered library as a native macOS Table. Row selection sets
// AppModel.selectedId, which the detail column reads to show the reader.
struct MacLibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var showAdd = false
    @State private var showChat = false

    var body: some View {
        @Bindable var model = model

        Table(model.filtered, selection: $model.selectedId) {
            TableColumn("Title") { p in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if p.fav {
                            Image(systemName: "star.fill")
                                .foregroundStyle(.yellow).font(.caption2)
                        }
                        if p.retracted != nil {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red).font(.caption2)
                        }
                        Text(p.title.isEmpty ? "Untitled" : p.title)
                            .fontWeight(p.read ? .regular : .medium)
                            .lineLimit(1)
                    }
                    Text(p.authors).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .padding(.vertical, 2)
            }
            TableColumn("Year") { p in
                Text(p.year > 0 ? String(p.year) : "—")
                    .foregroundStyle(.secondary)
            }
            .width(min: 44, ideal: 54, max: 70)
            TableColumn("Venue") { p in
                Text(p.venue).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .contextMenu(forSelectionType: Paper.ID.self) { ids in
            if let id = ids.first, let p = model.paper(id) {
                Button(p.fav ? "Unfavorite" : "Favorite") { model.toggleFav(id) }
                Button(p.read ? "Mark Unread" : "Mark Read") { model.toggleRead(id) }
                Divider()
                Button("Delete", role: .destructive) { model.deletePaper(id) }
            }
        }
        .searchable(text: $model.query, prompt: "Search library")
        .navigationTitle(title)
        .navigationSubtitle("\(model.filtered.count) papers")
        .toolbar {
            ToolbarItemGroup {
                Picker("Sort", selection: $model.sortKey) {
                    Text("Recent").tag("added")
                    Text("Year").tag("year")
                    Text("Title").tag("title")
                }
                .pickerStyle(.menu)

                Button { showChat = true } label: { Image(systemName: "bubble.left.and.text.bubble.right") }
                    .help("Chat with your library")

                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .help("Add paper")

                Button {
                    Task { await model.syncNow() }
                } label: {
                    if model.syncing {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
                .help(model.syncStatus ?? "Sync with server")
                .disabled(model.syncing)
            }
        }
        .sheet(isPresented: $showAdd) { MacAddPaperView().environment(model) }
        .sheet(isPresented: $showChat) { MacChatView(paper: nil).environment(model) }
    }

    private var title: String {
        switch model.filter {
        case "all": return "All Papers"
        case "queue": return "Reading Queue"
        case "unread": return "Unread"
        case "fav": return "Favorites"
        case "bookmarks": return "Bookmarks"
        case "feeds": return "Feeds"
        case "archived": return "Archived"
        default:
            if model.filter.hasPrefix("tag:") { return "#" + model.filter.dropFirst(4) }
            return model.collections.first { $0.id == model.filter }?.name ?? "Library"
        }
    }
}
