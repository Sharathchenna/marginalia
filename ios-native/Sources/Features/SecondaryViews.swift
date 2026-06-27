import SwiftUI

// Blog feeds — subscribe, refresh, and jump to a feed's posts. Mirrors Feeds.tsx.
struct FeedsView: View {
    @Environment(AppModel.self) private var model
    @State private var showAdd = false
    @State private var newURL = ""
    @State private var error: String?

    var body: some View {
        List {
            if model.feeds.isEmpty {
                ContentUnavailableView("No feeds", systemImage: "dot.radiowaves.up.forward",
                                       description: Text("Subscribe to a blog or journal RSS/Atom feed."))
            } else {
                ForEach(model.feeds) { f in
                    Button { model.pickFilter("feed:" + f.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title).font(.subheadline.weight(.medium)).lineLimit(1)
                                if let e = f.lastError {
                                    Text(e).font(.caption).foregroundStyle(.red)
                                } else {
                                    Text(f.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer()
                            let u = model.feedUnread[f.id] ?? 0
                            if u > 0 { Text("\(u)").font(.caption).foregroundStyle(.secondary) }
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { model.removeFeed(f.id) } label: { Label("Unsubscribe", systemImage: "trash") }
                    }
                }
            }
        }
        .navigationTitle("Blog Feeds")
        .task { if let u = ProcessInfo.processInfo.environment["MARG_FEED"], model.feeds.isEmpty { error = await model.addFeed(u) } }
        .refreshable { await model.refreshFeeds() }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showAdd = true } label: { Image(systemName: "plus") } } }
        .alert("Add feed", isPresented: $showAdd) {
            TextField("https://blog.example.com/feed.xml", text: $newURL)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Subscribe") { let u = newURL; newURL = ""; Task { error = await model.addFeed(u) } }
            Button("Cancel", role: .cancel) { newURL = "" }
        } message: { Text("Paste an RSS or Atom feed URL.") }
        .alert("Couldn't add feed", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) { error = nil }
        } message: { Text(error ?? "") }
    }
}

// Discover — the "Latest" LLM-research feed (from the self-hosted server) plus
// arXiv search. Added papers go into the library (and sync). Mirrors Discover.tsx.
struct DiscoverView: View {
    @Environment(AppModel.self) private var model
    @State private var mode = "latest"
    @State private var query = ""
    @State private var results: [Paper] = []
    @State private var feed: [LatestFeed.Item] = []
    @State private var loading = false
    @State private var error: String?

    private func inLibrary(_ id: String) -> Bool { model.papers.contains { $0.id == id } }

    var body: some View {
        List {
            Picker("", selection: $mode) {
                Text("Latest").tag("latest")
                Text("Search arXiv").tag("search")
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            if loading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(mode == "latest" ? "Loading latest…" : "Searching arXiv…").foregroundStyle(.secondary)
                }
            }
            if let e = error { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.callout) }

            if mode == "latest" {
                ForEach(feed) { it in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(it.title).font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Label("\(it.upvotes)", systemImage: "arrow.up").font(.caption2).foregroundStyle(.orange)
                        }
                        if !it.authors.isEmpty { Text(it.authors).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        if !it.summary.isEmpty { Text(it.summary).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                        HStack {
                            Spacer()
                            if it.inLibrary || inLibrary("arxiv-" + it.arxiv) {
                                Label("In library", systemImage: "checkmark").font(.caption).foregroundStyle(.green)
                            } else {
                                Button { model.addPaper(it.toPaper()) } label: { Label("Add", systemImage: "plus") }
                                    .buttonStyle(.bordered).controlSize(.small)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                if feed.isEmpty && !loading && error == nil {
                    ContentUnavailableView("Latest LLM papers", systemImage: "sparkles",
                                           description: Text("Trending papers from Hugging Face. Set the AI backend in Settings to load."))
                }
            } else {
                ForEach(results) { p in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(p.title).font(.subheadline.weight(.semibold))
                        Text([p.authors, p.year > 0 ? String(p.year) : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                        if !p.abstract.isEmpty { Text(p.abstract).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                        HStack {
                            Spacer()
                            if inLibrary(p.id) {
                                Label("In library", systemImage: "checkmark").font(.caption).foregroundStyle(.green)
                            } else {
                                Button { model.addPaper(p) } label: { Label("Add", systemImage: "plus") }
                                    .buttonStyle(.bordered).controlSize(.small)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                if results.isEmpty && !loading && error == nil {
                    ContentUnavailableView("Search arXiv", systemImage: "magnifyingglass",
                                           description: Text("Find papers by title, author, or topic."))
                }
            }
        }
        .navigationTitle("Discover")
        .searchable(text: $query, prompt: "Search arXiv")
        .onSubmit(of: .search) { mode = "search"; Task { await runSearch() } }
        .task { await loadFeed() }
        .onChange(of: mode) { _, m in if m == "latest" && feed.isEmpty { Task { await loadFeed() } } }
    }

    private func loadFeed() async {
        guard feed.isEmpty else { return }
        loading = true; error = nil
        defer { loading = false }
        do { feed = try await LatestFeed.fetch(apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
        catch let err { error = (err as? LocalizedError)?.errorDescription ?? err.localizedDescription }
    }

    private func runSearch() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        loading = true; error = nil
        defer { loading = false }
        do { results = try await DiscoverService.search(q) }
        catch let err { error = (err as? LocalizedError)?.errorDescription ?? err.localizedDescription }
    }
}

// Notebook — every note and highlight in one place. Mirrors Notebook.tsx.
struct NotebookView: View {
    @Environment(AppModel.self) private var model

    private var withNotes: [Paper] { model.papers.filter { !$0.notes.isEmpty || !$0.hl.isEmpty } }

    var body: some View {
        List {
            if withNotes.isEmpty {
                ContentUnavailableView("No notes yet", systemImage: "book",
                                       description: Text("Notes and highlights you add to papers appear here."))
            }
            ForEach(withNotes) { p in
                Section(p.title) {
                    if !p.notes.isEmpty { Text(p.notes).font(.callout) }
                    ForEach(Array(p.hl.enumerated()), id: \.offset) { _, h in
                        HStack(alignment: .top, spacing: 8) {
                            RoundedRectangle(cornerRadius: 2).fill(Color(hex: h.color)).frame(width: 4)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.text).font(.footnote)
                                if !h.note.isEmpty { Text(h.note).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Notebook")
    }
}
