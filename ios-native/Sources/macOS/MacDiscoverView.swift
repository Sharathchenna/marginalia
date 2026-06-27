import SwiftUI

// Discover: "Latest" curated LLM research from the server (/v1/feed/latest) and
// arXiv keyword search. One-click add to the library. Mirrors DiscoverView.
struct MacDiscoverView: View {
    @Environment(AppModel.self) private var model
    @State private var mode = 0 // 0 = Latest, 1 = Search
    @State private var latest: [LatestFeed.Item] = []
    @State private var results: [Paper] = []
    @State private var query = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $mode) {
                Text("Latest").tag(0)
                Text("Search arXiv").tag(1)
            }
            .pickerStyle(.segmented).labelsHidden().padding(12).frame(maxWidth: 360)

            if mode == 1 {
                HStack {
                    TextField("Search arXiv…", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { runSearch() }
                    Button("Search") { runSearch() }.disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, 12).padding(.bottom, 8)
            }

            if loading { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let error { ContentUnavailableView("Couldn't load", systemImage: "wifi.slash", description: Text(error)) }
            else { content }
        }
        .navigationTitle("Discover")
        .toolbar { syncToolbar(model) }
        .task { if latest.isEmpty { await loadLatest() } }
    }

    @ViewBuilder
    private var content: some View {
        if mode == 0 {
            List(latest) { item in
                row(title: item.title, authors: item.authors, summary: item.summary,
                    badge: "▲ \(item.upvotes)",
                    inLibrary: item.inLibrary || model.papers.contains { $0.id == "arxiv-\(item.arxiv)" }) {
                    model.addPaper(item.toPaper())
                }
            }
        } else {
            if results.isEmpty {
                ContentUnavailableView("Search arXiv", systemImage: "magnifyingglass",
                    description: Text("Find papers by title, author, or topic."))
            } else {
                List(results) { p in
                    row(title: p.title, authors: p.authors, summary: p.abstract, badge: p.year > 0 ? String(p.year) : nil,
                        inLibrary: model.papers.contains { $0.id == p.id }) {
                        model.addPaper(p)
                    }
                }
            }
        }
    }

    private func row(title: String, authors: String, summary: String, badge: String?, inLibrary: Bool, add: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).fontWeight(.medium).lineLimit(2)
                Text(authors).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if !summary.isEmpty {
                    Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            VStack(spacing: 6) {
                if let badge { Text(badge).font(.caption).foregroundStyle(.secondary) }
                if inLibrary {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                } else {
                    Button { add() } label: { Image(systemName: "plus.circle") }
                        .buttonStyle(.borderless)
                }
            }
        }
        .padding(.vertical, 3)
    }

    private func loadLatest() async {
        loading = true; error = nil
        do { latest = try await LatestFeed.fetch(apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
        catch { self.error = error.localizedDescription }
        loading = false
    }

    private func runSearch() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        loading = true; error = nil
        Task {
            do { results = try await DiscoverService.search(q) }
            catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}
