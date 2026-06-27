import SwiftUI

// Left column: smart filters + collections + top tags. Selection drives the
// library via AppModel.pickFilter (which the model already implements for iOS).
struct MacSidebarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // Bridge the model's non-optional `filter` to List's optional selection,
        // routing changes through pickFilter so screen/nav state stay consistent.
        let selection = Binding<String?>(
            get: { model.filter },
            set: { model.pickFilter($0 ?? "all") }
        )

        List(selection: selection) {
            Section("Library") {
                row("all", "All Papers", "tray.full", model.counts.all)
                row("queue", "Reading Queue", "books.vertical", model.counts.queue)
                row("unread", "Unread", "circle", model.counts.unread)
                row("fav", "Favorites", "star", model.counts.fav)
                row("bookmarks", "Bookmarks", "bookmark", model.counts.bookmarks)
                row("feeds", "Feeds", "dot.radiowaves.up.forward", model.counts.feedsUnread)
                row("archived", "Archived", "archivebox", model.counts.archived)
            }

            if !model.collections.isEmpty {
                Section("Collections") {
                    ForEach(model.collections) { c in
                        Label(c.name.isEmpty ? "Untitled" : c.name, systemImage: "folder")
                            .badge(model.collectionCount(c.id))
                            .tag(c.id)
                    }
                }
            }

            if !model.topTags.isEmpty {
                Section("Tags") {
                    ForEach(model.topTags, id: \.self) { t in
                        Label(t, systemImage: "tag")
                            .tag("tag:\(t)")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 200)
    }

    @ViewBuilder
    private func row(_ id: String, _ title: String, _ icon: String, _ count: Int) -> some View {
        Label(title, systemImage: icon)
            .badge(count)
            .tag(id)
    }
}
