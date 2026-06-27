import Foundation

// All app data access goes through this protocol — the analogue of the
// `Repository` interface in src/lib/repo.ts. Phase A ships a local JSON-file
// backend; Phase G adds a RemoteRepository (HTTP) behind the same protocol.
protocol Repository {
    func loadPapers() -> [Paper]
    func savePapers(_ papers: [Paper])
    func loadCollections() -> [LibraryCollection]
    func saveCollections(_ collections: [LibraryCollection])
    func loadFeeds() -> [Feed]
    func saveFeeds(_ feeds: [Feed])
    func loadSettings() -> Settings
    func saveSettings(_ settings: Settings)
}

// Local-first backend. Persists each store to a JSON file under Application
// Support, seeding papers + collections from the bundled seed.json on first run —
// the native mirror of localRepo.ts / db.rs.
final class FileRepository: Repository {
    private let dir: URL
    private let enc: JSONEncoder = {
        let e = JSONEncoder(); e.outputFormatting = [.withoutEscapingSlashes]; return e
    }()

    init() {
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        dir = base.appendingPathComponent("Marginalia", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        seedIfNeeded()
    }

    private func fileURL(_ name: String) -> URL { dir.appendingPathComponent(name) }

    private func read<T: Decodable>(_ name: String, _ fallback: T) -> T {
        guard let data = try? Data(contentsOf: fileURL(name)) else { return fallback }
        return (try? JSONDecoder().decode(T.self, from: data)) ?? fallback
    }
    private func write<T: Encodable>(_ name: String, _ value: T) {
        guard let data = try? enc.encode(value) else { return }
        try? data.write(to: fileURL(name), options: .atomic)
    }

    private func seedIfNeeded() {
        guard !FileManager.default.fileExists(atPath: fileURL("papers.json").path) else { return }
        let seed = Self.bundledSeed()
        write("papers.json", seed.papers)
        write("collections.json", seed.collections)
        write("settings.json", Settings())
        write("feeds.json", [Feed]())
    }

    private struct Seed: Decodable { var papers: [Paper] = []; var collections: [LibraryCollection] = [] }
    private static func bundledSeed() -> Seed {
        guard let u = Bundle.main.url(forResource: "seed", withExtension: "json"),
              let d = try? Data(contentsOf: u),
              let s = try? JSONDecoder().decode(Seed.self, from: d) else { return Seed() }
        return s
    }

    func loadPapers() -> [Paper] { read("papers.json", []) }
    func savePapers(_ papers: [Paper]) { write("papers.json", papers) }
    func loadCollections() -> [LibraryCollection] { read("collections.json", []) }
    func saveCollections(_ collections: [LibraryCollection]) { write("collections.json", collections) }
    func loadFeeds() -> [Feed] { read("feeds.json", []) }
    func saveFeeds(_ feeds: [Feed]) { write("feeds.json", feeds) }
    func loadSettings() -> Settings { read("settings.json", Settings()) }
    func saveSettings(_ settings: Settings) { write("settings.json", settings) }
}
