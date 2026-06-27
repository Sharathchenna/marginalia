import SwiftUI

// Middle column: the filtered library as a native macOS Table. Supports text
// filtering and (when configured) server-backed semantic search. Row selection
// sets AppModel.selectedId, which the detail column reads to show the reader.
struct MacLibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var showChat = false
    @State private var semanticMode = false
    @State private var semanticIds: [String] = []
    @State private var searching = false

    // The rows to show: semantic ranking when active + non-empty, else the model's
    // text-filtered list.
    private var rows: [Paper] {
        guard semanticMode, !model.query.trimmingCharacters(in: .whitespaces).isEmpty, !semanticIds.isEmpty
        else { return model.filtered }
        let byId = Dictionary(model.papers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return semanticIds.compactMap { byId[$0] }.filter { !$0.deleted }
    }

    var body: some View {
        @Bindable var model = model

        Table(rows, selection: $model.selectedId) {
            TableColumn("Title") { p in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if p.fav { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption2) }
                        if p.retracted != nil {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.caption2)
                        }
                        Text(p.title.isEmpty ? "Untitled" : p.title)
                            .fontWeight(p.read ? .regular : .medium).lineLimit(1)
                    }
                    Text(p.authors).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .padding(.vertical, 2)
            }
            TableColumn("Year") { p in Text(p.year > 0 ? String(p.year) : "—").foregroundStyle(.secondary) }
                .width(min: 44, ideal: 54, max: 70)
            TableColumn("Venue") { p in Text(p.venue).foregroundStyle(.secondary).lineLimit(1) }
        }
        .contextMenu(forSelectionType: Paper.ID.self) { ids in
            if let id = ids.first, let p = model.paper(id) {
                Button(p.fav ? "Unfavorite" : "Favorite") { model.toggleFav(id) }
                Button(p.read ? "Mark Unread" : "Mark Read") { model.toggleRead(id) }
                Divider()
                Button("Delete", role: .destructive) { model.deletePaper(id) }
            }
        }
        .searchable(text: $model.query, prompt: semanticMode ? "Semantic search…" : "Search library")
        .onSubmit(of: .search) { if semanticMode { runSemantic() } }
        .onChange(of: semanticMode) { _, on in if !on { semanticIds = [] } else { runSemantic() } }
        .navigationTitle(title)
        .navigationSubtitle("\(rows.count) papers")
        .toolbar {
            ToolbarItemGroup {
                Toggle(isOn: $semanticMode) { Image(systemName: "brain") }
                    .toggleStyle(.button).help("Semantic search")
                if searching { ProgressView().controlSize(.small) }

                Picker("Sort", selection: $model.sortKey) {
                    Text("Recent").tag("added")
                    Text("Year").tag("year")
                    Text("Title").tag("title")
                }
                .pickerStyle(.menu).disabled(semanticMode)

                Button { showChat = true } label: { Image(systemName: "bubble.left.and.text.bubble.right") }
                    .help("Chat with your library")
                Button { model.presentAdd = true } label: { Image(systemName: "plus") }
                    .help("Add paper")
                Button { Task { await model.syncNow() } } label: {
                    if model.syncing { ProgressView().controlSize(.small) }
                    else { Image(systemName: "arrow.triangle.2.circlepath") }
                }
                .help(model.syncStatus ?? "Sync with server").disabled(model.syncing)
            }
        }
        .sheet(isPresented: $showChat) { MacChatView(paper: nil).environment(model) }
    }

    private func runSemantic() {
        let q = model.query.trimmingCharacters(in: .whitespaces)
        guard semanticMode, !q.isEmpty else { semanticIds = []; return }
        searching = true
        Task {
            semanticIds = await SearchService.semantic(q, apiUrl: model.settings.apiUrl, token: model.settings.apiToken)
            searching = false
        }
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
            if model.filter.hasPrefix("feed:") { return "Feed" }
            return model.collections.first { $0.id == model.filter }?.name ?? "Library"
        }
    }
}
