import Foundation
import Observation

enum Screen: String, Hashable {
    case dashboard, library, reader, notebook, graph, flashcards, discover, feeds, review, settings, onboarding
}

struct SidebarCounts {
    var queue = 0, all = 0, fav = 0, unread = 0, bookmarks = 0, archived = 0, feedsUnread = 0
}

// The app's single state hub — the native analogue of src/store.ts. Holds the
// loaded library, navigation/filter state, and the mutating actions, persisting
// every change through the Repository.
@Observable
final class AppModel {
    var papers: [Paper] = []
    var collections: [LibraryCollection] = []
    var feeds: [Feed] = []
    var settings = Settings()

    var screen: Screen = .library
    var filter: String = "all"
    var selectedId: String?
    /// macOS: drives the "New Paper" command's add sheet from the menu/toolbar.
    var presentAdd = false
    var query: String = ""
    var sortKey: String = "added"   // added | year | title
    var loaded = false

    // Detail navigation stack (pushes the reader). Also used by launch overrides.
    var navPath: [Paper] = []
    var pendingOpen: String?
    var launchOverride = false
    // On iPhone (compact), drives NavigationSplitView to show the detail column
    // when the user picks a sidebar item.
    var preferredColumnDetail = false

    private let repo: Repository
    init(repo: Repository = FileRepository()) {
        self.repo = repo
        load()
        applyLaunchOverrides()
    }

    // Dev/screenshot affordance: `MARG_SCREEN`, `MARG_FILTER`, `MARG_OPEN` env vars
    // (set via `simctl launch … --env`) drive the initial screen so any view can be
    // captured headlessly without tapping. No effect in normal launches.
    private func applyLaunchOverrides() {
        let env = ProcessInfo.processInfo.environment
        if let f = env["MARG_FILTER"], !f.isEmpty { filter = f; screen = .library; launchOverride = true }
        if let s = env["MARG_SCREEN"], let sc = Screen(rawValue: s) { screen = sc; launchOverride = true }
        if let pid = env["MARG_OPEN"], paper(pid) != nil { pendingOpen = pid; selectedId = pid; launchOverride = true }
        if let v = env["MARG_VIEW"], v == "card" || v == "table" { settings.view = v; launchOverride = true }
        if let api = env["MARG_API"], !api.isEmpty { settings.apiUrl = api; launchOverride = true }
        if launchOverride { preferredColumnDetail = true }
    }

    func load() {
        papers = repo.loadPapers()
        collections = repo.loadCollections()
        feeds = repo.loadFeeds()
        settings = repo.loadSettings()
        loadPendingDeletes()
        loaded = true
        Task { await syncNow() } // pull/push against the self-hosted server on launch
    }

    // ---- persistence ----
    private func persistPapers() { repo.savePapers(papers) }
    private func persistCollections() { repo.saveCollections(collections) }
    func persistSettings() { repo.saveSettings(settings) }

    private func index(_ id: String) -> Int? { papers.firstIndex { $0.id == id } }
    func paper(_ id: String?) -> Paper? { id.flatMap { pid in papers.first { $0.id == pid } } }

    // ---- navigation ----
    func goScreen(_ s: Screen) { screen = s; navPath = []; preferredColumnDetail = true }
    func pickFilter(_ f: String) { filter = f; screen = .library; navPath = []; preferredColumnDetail = true }
    func openReader(_ id: String) {
        guard let p = paper(id) else { return }
        navPath = [p]; preferredColumnDetail = true
    }

    // ---- paper mutations ----
    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
    /// Stamp a local change time so the record syncs, then persist + schedule push.
    private func touch(_ i: Int) { papers[i].updatedTs = Self.nowMs() }

    func toggleFav(_ id: String) {
        guard let i = index(id) else { return }
        papers[i].fav.toggle(); touch(i); persistPapers(); scheduleSync()
    }
    func toggleRead(_ id: String) {
        guard let i = index(id) else { return }
        papers[i].read.toggle()
        papers[i].status = papers[i].read ? .done : .unread
        touch(i); persistPapers(); scheduleSync()
    }
    func setStatus(_ id: String, _ status: ReadingStatus) {
        guard let i = index(id) else { return }
        papers[i].status = status
        papers[i].read = (status == .done)
        touch(i); persistPapers(); scheduleSync()
    }
    func setArchived(_ id: String, _ archived: Bool) {
        guard let i = index(id) else { return }
        papers[i].archived = archived; touch(i); persistPapers(); scheduleSync()
    }
    func updatePaper(_ id: String, _ mutate: (inout Paper) -> Void) {
        guard let i = index(id) else { return }
        mutate(&papers[i]); touch(i); persistPapers(); scheduleSync()
    }
    func addPaper(_ p: Paper) {
        var p = p; p.updatedTs = Self.nowMs()
        papers.removeAll { $0.id == p.id }
        papers.insert(p, at: 0); persistPapers(); scheduleSync()
    }
    func deletePaper(_ id: String) {
        papers.removeAll { $0.id == id }
        for ci in collections.indices { collections[ci].ids.removeAll { $0 == id } }
        if selectedId == id { selectedId = nil }
        pendingDeletes.insert(id); savePendingDeletes()
        persistPapers(); persistCollections(); scheduleSync()
    }

    // ---- collections ----
    func createCollection(_ name: String) {
        let id = "col-" + UUID().uuidString.prefix(8)
        collections.append(LibraryCollection(id: id, name: name, color: Self.randomColor(), indent: "0", ids: []))
        collectionsDirty = true; persistCollections(); scheduleSync()
    }
    func renameCollection(_ id: String, _ name: String) {
        guard let i = collections.firstIndex(where: { $0.id == id }) else { return }
        collections[i].name = name; collectionsDirty = true; persistCollections(); scheduleSync()
    }
    func deleteCollection(_ id: String) {
        collections.removeAll { $0.id == id }
        if filter == id { filter = "all" }
        collectionsDirty = true; persistCollections(); scheduleSync()
    }
    func toggleInCollection(_ paperId: String, _ collectionId: String) {
        guard let i = collections.firstIndex(where: { $0.id == collectionId }) else { return }
        if collections[i].ids.contains(paperId) {
            collections[i].ids.removeAll { $0 == paperId }
        } else {
            collections[i].ids.append(paperId)
        }
        collectionsDirty = true; persistCollections(); scheduleSync()
    }

    // ---- feeds (RSS/Atom) ----
    func persistFeeds() { repo.saveFeeds(feeds) }

    @MainActor
    func addFeed(_ urlString: String) async -> String? {
        let url = urlString.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty else { return "Empty URL" }
        if feeds.contains(where: { $0.id == url }) { return "Already subscribed" }
        do {
            let res = try await FeedService.fetch(url)
            feeds.append(Feed(id: url, url: url, siteUrl: res.site,
                              title: res.title.isEmpty ? url : res.title, lastFetched: SRS.now()))
            persistFeeds()
            mergePosts(res.posts, feedId: url)
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    @MainActor
    func refreshFeeds() async {
        for f in feeds {
            if let res = try? await FeedService.fetch(f.url) {
                mergePosts(res.posts, feedId: f.id)
                if let i = feeds.firstIndex(where: { $0.id == f.id }) {
                    feeds[i].lastFetched = SRS.now(); feeds[i].lastError = nil
                }
            } else if let i = feeds.firstIndex(where: { $0.id == f.id }) {
                feeds[i].lastError = "Fetch failed"
            }
        }
        persistFeeds()
    }

    func removeFeed(_ id: String) {
        feeds.removeAll { $0.id == id }
        if filter == "feed:" + id { filter = "feeds" }
        persistFeeds()
    }

    private func mergePosts(_ posts: [Paper], feedId: String) {
        var added = false
        for var post in posts {
            post.feedId = feedId
            let dup = papers.contains { $0.id == post.id || ($0.url != nil && $0.url == post.url && post.url != nil) }
            if !dup { papers.insert(post, at: 0); added = true }
        }
        if added { persistPapers() }
    }

    var feedUnread: [String: Int] {
        var m: [String: Int] = [:]
        for p in papers where p.itemKind == .article && p.source == .feed && !p.read {
            if let fid = p.feedId { m[fid, default: 0] += 1 }
        }
        return m
    }

    // ---- flashcards / review (SRS) ----
    func gradeCard(_ paperId: String, _ hlIndex: Int, _ g: Grade) {
        guard let i = index(paperId) else { return }
        var cards = papers[i].cards ?? [:]
        cards[String(hlIndex)] = SRS.grade(cards[String(hlIndex)], g)
        papers[i].cards = cards
        persistPapers()
    }
    var dueCards: [DueCard] { SRS.dueCards(papers) }
    var allCards: [DueCard] { SRS.allCards(papers) }

    // ---- sync ----
    var syncing = false
    var syncStatus: String?
    var pendingDeletes: Set<String> = []
    private var collectionsDirty = false
    private var feedsDirty = false
    private var syncDebounce: Task<Void, Never>?

    /// The self-hosted data server, when configured (same server as PDFs/AI).
    private var remoteSync: RemoteSync? {
        guard let base = PDFService.serverBase(apiUrl: settings.apiUrl), !settings.apiToken.isEmpty
        else { return nil }
        return RemoteSync(base: base, token: settings.apiToken)
    }

    private func savePendingDeletes() {
        UserDefaults.standard.set(Array(pendingDeletes), forKey: "marg.pendingDeletes")
    }
    func loadPendingDeletes() {
        pendingDeletes = Set(UserDefaults.standard.stringArray(forKey: "marg.pendingDeletes") ?? [])
    }

    /// Debounced background sync after a local change.
    func scheduleSync() {
        guard remoteSync != nil else { return }
        syncDebounce?.cancel()
        syncDebounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if Task.isCancelled { return }
            await self?.syncNow()
        }
    }

    @MainActor
    func syncNow() async {
        if let sync = remoteSync { await syncServer(sync); return }
        if !settings.webdavUrl.isEmpty { await syncWebDAV() }
        // else: nothing configured — silent no-op.
    }

    // Per-record sync against the self-hosted server: push local deltas, pull remote.
    @MainActor
    private func syncServer(_ sync: RemoteSync) async {
        if syncing { return }
        syncing = true; syncStatus = "Syncing…"
        defer { syncing = false }
        let since = settings.lastSyncTs
        let pushAll = since <= 0 // first sync: seed the server with the whole library
        do {
            for p in papers where pushAll || p.updatedTs > since { try await sync.pushPaper(p) }
            for id in pendingDeletes { try? await sync.deletePaper(id) }
            if collectionsDirty || pushAll { try? await sync.putCollections(collections) }
            if feedsDirty || pushAll { try? await sync.putFeeds(feeds) }
            let pulled = try await sync.pull(since: since)
            applyPulled(pulled)
            pendingDeletes.removeAll(); savePendingDeletes()
            collectionsDirty = false; feedsDirty = false
            settings.lastSyncTs = pulled.serverTs; persistSettings()
            syncStatus = "Synced \(papers.count) items."
        } catch {
            syncStatus = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    // Merge a server pull into local state: LWW on updatedTs; tombstones removed.
    private func applyPulled(_ pulled: RemoteSync.Pulled) {
        var map = Dictionary(papers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for rp in pulled.papers {
            if rp.deleted { map[rp.id] = nil; continue }
            if let local = map[rp.id], local.updatedTs > rp.updatedTs { continue } // local is newer
            map[rp.id] = rp
        }
        papers = map.values.filter { !$0.deleted }.sorted { $0.addedTs > $1.addedTs }
        if let rc = pulled.collections, (pulled.collectionsTs ?? 0) > settings.lastSyncTs { collections = rc }
        if let rf = pulled.feeds, (pulled.feedsTs ?? 0) > settings.lastSyncTs { feeds = rf }
        persistPapers(); persistCollections(); persistFeeds()
    }

    // Encrypted WebDAV snapshot — fallback when no self-hosted server is set.
    @MainActor
    private func syncWebDAV() async {
        let svc = SyncService(url: settings.webdavUrl, user: settings.webdavUser,
                              pass: settings.webdavPass, passphrase: settings.syncPassphrase)
        guard svc.isConfigured else { return }
        syncing = true; syncStatus = "Syncing…"
        defer { syncing = false }
        do {
            if let remote = try await svc.pull() { adoptSnapshot(remote) }
            try await svc.push(LibrarySnapshot(papers: papers, collections: collections, feeds: feeds, ts: SRS.now()))
            settings.lastSyncTs = SRS.now(); persistSettings()
            syncStatus = "Synced \(papers.count) items."
        } catch {
            syncStatus = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func adoptSnapshot(_ s: LibrarySnapshot) {
        var pmap = Dictionary(papers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for p in s.papers where pmap[p.id] == nil { pmap[p.id] = p }
        papers = pmap.values.sorted { $0.addedTs > $1.addedTs }
        var cmap = Dictionary(collections.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for c in s.collections where cmap[c.id] == nil { cmap[c.id] = c }
        collections = Array(cmap.values)
        var fmap = Dictionary(feeds.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for f in s.feeds where fmap[f.id] == nil { fmap[f.id] = f }
        feeds = Array(fmap.values)
        persistPapers(); persistCollections(); persistFeeds()
    }

    // ---- settings ----
    func setModel(_ m: String) { settings.model = m; persistSettings() }
    func setTheme(_ t: String) { settings.theme = t; persistSettings() }

    private static func randomColor() -> String {
        ["#4B57D6", "#D6634B", "#3FA34D", "#B5489A", "#C99A28", "#2E8C9E"].randomElement()!
    }

    // ---- derived: filtering + counts ----
    private func matchesFilter(_ p: Paper, _ f: String) -> Bool {
        switch f {
        case "all":       return p.itemKind == .paper && p.archived != true
        case "recent":    return p.archived != true
        case "fav":       return p.fav
        case "unread":    return !p.read && p.itemKind == .paper
        case "queue":     return p.effectiveStatus != .done && p.archived != true && p.itemKind == .paper
        case "untagged":  return p.tags.isEmpty
        case "bookmarks": return p.itemKind == .article && p.source == .clip && p.archived != true
        case "feeds":     return p.itemKind == .article && p.source == .feed
        case "archived":  return p.archived == true
        default:
            if f.hasPrefix("tag:") { return p.tags.contains(String(f.dropFirst(4))) }
            if f.hasPrefix("feed:") { return p.feedId == String(f.dropFirst(5)) }
            if let c = collections.first(where: { $0.id == f }) { return c.ids.contains(p.id) }
            return true
        }
    }

    private func matchesQuery(_ p: Paper, _ q: String) -> Bool {
        if q.isEmpty { return true }
        let needle = q.lowercased()
        let hay = [p.title, p.authors, p.authorsFull, p.abstract, p.venue, p.tags.joined(separator: " ")]
            .joined(separator: " ").lowercased()
        return needle.split(separator: " ").allSatisfy { hay.contains($0) }
    }

    var filtered: [Paper] {
        var list = papers.filter { matchesFilter($0, filter) && matchesQuery($0, query) }
        switch sortKey {
        case "year":  list.sort { $0.year > $1.year }
        case "title": list.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        default:      list.sort { $0.addedTs > $1.addedTs }
        }
        return list
    }

    var counts: SidebarCounts {
        var c = SidebarCounts()
        for p in papers {
            if matchesFilter(p, "all") { c.all += 1 }
            if p.fav { c.fav += 1 }
            if matchesFilter(p, "unread") { c.unread += 1 }
            if matchesFilter(p, "queue") { c.queue += 1 }
            if matchesFilter(p, "bookmarks") { c.bookmarks += 1 }
            if p.archived == true { c.archived += 1 }
            if p.itemKind == .article && p.source == .feed && !p.read { c.feedsUnread += 1 }
        }
        return c
    }

    func collectionCount(_ id: String) -> Int { collections.first { $0.id == id }?.ids.count ?? 0 }

    // The most-used tags, for the sidebar (mirrors Sidebar.tsx).
    var topTags: [String] {
        var freq: [String: Int] = [:]
        for p in papers { for t in p.tags { freq[t, default: 0] += 1 } }
        return freq.sorted { $0.value > $1.value }.prefix(8).map(\.key)
    }
}
