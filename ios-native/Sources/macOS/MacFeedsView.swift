import SwiftUI

// RSS/Atom subscriptions: add, list with unread counts, refresh, unsubscribe.
// Clicking a feed filters the library to that feed's posts. Mirrors FeedsView.
struct MacFeedsView: View {
    @Environment(AppModel.self) private var model
    @State private var showAdd = false
    @State private var newURL = ""
    @State private var addError: String?
    @State private var adding = false
    @State private var refreshing = false

    var body: some View {
        Group {
            if model.feeds.isEmpty {
                ContentUnavailableView {
                    Label("No feeds", systemImage: "dot.radiowaves.up.forward")
                } description: {
                    Text("Subscribe to a blog or journal RSS/Atom feed.")
                } actions: {
                    Button("Add Feed") { showAdd = true }
                }
            } else {
                List {
                    ForEach(model.feeds) { f in
                        Button { model.pickFilter("feed:" + f.id) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(f.title.isEmpty ? f.url : f.title).lineLimit(1)
                                    if let e = f.lastError {
                                        Text(e).font(.caption).foregroundStyle(.red).lineLimit(1)
                                    } else {
                                        Text(f.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                                let unread = model.feedUnread[f.id] ?? 0
                                if unread > 0 {
                                    Text("\(unread)").font(.caption).padding(.horizontal, 7).padding(.vertical, 2)
                                        .background(.tint, in: Capsule()).foregroundStyle(.white)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Unsubscribe", role: .destructive) { model.removeFeed(f.id) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Feeds")
        .toolbar {
            ToolbarItemGroup {
                Button {
                    refreshing = true
                    Task { await model.refreshFeeds(); refreshing = false }
                } label: {
                    if refreshing { ProgressView().controlSize(.small) }
                    else { Image(systemName: "arrow.clockwise") }
                }
                .help("Refresh all feeds").disabled(refreshing || model.feeds.isEmpty)
                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .help("Add feed")
            }
        }
        .sheet(isPresented: $showAdd) { addSheet }
    }

    private var addSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Subscribe to a feed").font(.headline)
            TextField("https://example.com/feed.xml", text: $newURL)
                .textFieldStyle(.roundedBorder)
                .frame(width: 360)
            if let e = addError { Text(e).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { showAdd = false; newURL = ""; addError = nil }
                Button(adding ? "Adding…" : "Subscribe") {
                    adding = true; addError = nil
                    Task {
                        let err = await model.addFeed(newURL)
                        adding = false
                        if let err { addError = err } else { showAdd = false; newURL = "" }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(adding || newURL.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
    }
}
