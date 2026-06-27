import SwiftUI

// The library — native mirror of Library.tsx. Table or card layout, search,
// sort, and per-row actions (favorite / read / delete).
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var showingAdd = false
    @State private var showingChat = false

    var body: some View {
        @Bindable var model = model
        Group {
            if model.settings.view == "card" {
                cardGrid
            } else {
                tableList
            }
        }
        .navigationTitle(Self.filterTitle(model.filter))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search library")
        .overlay {
            if model.filtered.isEmpty {
                ContentUnavailableView(
                    model.query.isEmpty ? "No papers" : "No matches",
                    systemImage: "books.vertical",
                    description: Text(model.query.isEmpty ? "Add a paper to get started." : "Try a different search.")
                )
            }
        }
        .sheet(isPresented: $showingAdd) { AddPaperView().environment(model) }
        .sheet(isPresented: $showingChat) { ChatView(paper: nil).environment(model) }
        .onAppear {
            if ProcessInfo.processInfo.environment["MARG_ADD"] == "1" { showingAdd = true }
            if ProcessInfo.processInfo.environment["MARG_CHAT"] == "1" { showingChat = true }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
            }
            ToolbarItem(placement: .topBarLeading) {
                Button { showingChat = true } label: { Image(systemName: "sparkles") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $model.sortKey) {
                        Label("Recently added", systemImage: "clock").tag("added")
                        Label("Year", systemImage: "calendar").tag("year")
                        Label("Title", systemImage: "textformat").tag("title")
                    }
                    Divider()
                    Picker("Layout", selection: Binding(
                        get: { model.settings.view },
                        set: { model.settings.view = $0; model.persistSettings() }
                    )) {
                        Label("List", systemImage: "list.bullet").tag("table")
                        Label("Cards", systemImage: "square.grid.2x2").tag("card")
                    }
                } label: { Image(systemName: "arrow.up.arrow.down") }
            }
        }
    }

    private var tableList: some View {
        List {
            ForEach(model.filtered) { p in
                NavigationLink(value: p) { PaperRow(paper: p) }
                    .swipeActions(edge: .leading) {
                        Button { model.toggleFav(p.id) } label: {
                            Label("Favorite", systemImage: p.fav ? "star.slash" : "star")
                        }.tint(.yellow)
                    }
                    .swipeActions(edge: .trailing) {
                        Button { model.toggleRead(p.id) } label: {
                            Label(p.read ? "Unread" : "Read", systemImage: p.read ? "circle" : "checkmark.circle")
                        }.tint(.blue)
                        Button(role: .destructive) { model.deletePaper(p.id) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu { rowMenu(p) }
            }
        }
        .listStyle(.plain)
    }

    private var cardGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                ForEach(model.filtered) { p in
                    NavigationLink(value: p) { PaperCard(paper: p) }
                        .buttonStyle(.plain)
                        .contextMenu { rowMenu(p) }
                }
            }
            .padding(12)
        }
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private func rowMenu(_ p: Paper) -> some View {
        Button { model.toggleFav(p.id) } label: { Label(p.fav ? "Unfavorite" : "Favorite", systemImage: "star") }
        Button { model.toggleRead(p.id) } label: { Label(p.read ? "Mark unread" : "Mark read", systemImage: "checkmark.circle") }
        Button(role: .destructive) { model.deletePaper(p.id) } label: { Label("Delete", systemImage: "trash") }
    }

    static func filterTitle(_ f: String) -> String {
        switch f {
        case "all": return "All Papers"
        case "fav": return "Favorites"
        case "unread": return "Unread"
        case "queue": return "Inbox"
        case "bookmarks": return "Bookmarks"
        case "archived": return "Archive"
        default:
            if f.hasPrefix("tag:") { return "#" + f.dropFirst(4) }
            return "Library"
        }
    }
}

struct PaperRow: View {
    let paper: Paper

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if !paper.read { Circle().fill(Color.accentColor).frame(width: 7, height: 7) }
                Text(paper.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 4)
                if paper.fav { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption2) }
            }
            Text(subtitle(paper)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if !paper.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(paper.tags, id: \.self) { t in
                            Text(t).font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12), in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct PaperCard: View {
    let paper: Paper

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if !paper.read { Circle().fill(Color.accentColor).frame(width: 7, height: 7) }
                Spacer()
                if paper.fav { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption2) }
            }
            Text(paper.title).font(.subheadline.weight(.semibold)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            Text(subtitle(paper)).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            if let first = paper.tags.first {
                Text(first).font(.caption2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12), in: Capsule())
            }
        }
        .padding(12)
        .frame(height: 150, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private func subtitle(_ paper: Paper) -> String {
    var parts: [String] = []
    if !paper.authors.isEmpty { parts.append(paper.authors) }
    if paper.year > 0 { parts.append(String(paper.year)) }
    if !paper.venue.isEmpty { parts.append(paper.venue) }
    return parts.joined(separator: " · ")
}
