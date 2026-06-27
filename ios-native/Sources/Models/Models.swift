import Foundation

// Port of src/types.ts. Papers are stored as JSON (same shape as the web/desktop
// app) so libraries round-trip between platforms.

enum ReadingStatus: String, Codable, Hashable { case unread, reading, done }
enum ItemKind: String, Codable, Hashable { case paper, article }
enum ArticleSource: String, Codable, Hashable { case clip, feed }

struct Highlight: Codable, Hashable {
    var text: String = ""
    var color: String = "#FBE38E"
    var page: Int = 1
    var note: String = ""
}

struct Card: Codable, Hashable {
    var due: Double = 0
    var ease: Double = 2.5
    var reps: Int = 0
}

struct Retraction: Codable, Hashable {
    var type: String = ""
    var reason: String = ""
    var date: String = ""
    var url: String = ""
}

struct LibraryCollection: Codable, Identifiable, Hashable {
    var id: String
    var name: String = ""
    var color: String = "#8A8A8A"
    var indent: String = "0"
    var ids: [String] = []
}

struct Feed: Codable, Identifiable, Hashable {
    var id: String
    var url: String = ""
    var siteUrl: String?
    var title: String = ""
    var favicon: String?
    var folder: String?
    var lastFetched: Double?
    var lastError: String?
    var etag: String?
    var lastModified: String?
}

struct Paper: Identifiable, Hashable {
    var id: String
    var title: String = ""
    var authors: String = ""
    var authorsFull: String = ""
    var year: Int = 0
    var venue: String = ""
    var doi: String = ""
    var arxiv: String = ""
    var tags: [String] = []
    var read: Bool = false
    var fav: Bool = false
    var added: String = ""
    var addedTs: Double = 0
    var updatedTs: Double = 0 // server-stamped change time, for per-record sync
    var deleted: Bool = false // tombstone (sync)
    var abstract: String = ""
    var notes: String = ""
    var hl: [Highlight] = []
    var file: String?
    var summary: String?
    var explainer: String?
    var markdown: String?
    var pdfUrl: String?
    var status: ReadingStatus?
    var related: [String]?
    var concepts: [String]?
    var fulltext: String?
    var lastPage: Int?
    var pages: Int?
    var cards: [String: Card]?
    var retracted: Retraction?
    var retractionChecked: Double?
    var kind: ItemKind?
    var source: ArticleSource?
    var url: String?
    var favicon: String?
    var feedId: String?
    var publishedTs: Double?
    var readingTime: Double?
    var archived: Bool?
}

// Lenient Codable: missing keys fall back to defaults (the seed JSON and older
// records only carry a subset of fields), and `init(from:)` lives in an extension
// so the memberwise initializer stays available for building new papers in code.
extension Paper: Codable {
    enum CodingKeys: String, CodingKey {
        case id, title, authors, authorsFull, year, venue, doi, arxiv, tags, read,
             fav, added, addedTs, updatedTs, deleted, abstract, notes, hl, file, summary, explainer, markdown,
             pdfUrl, status, related, concepts, fulltext, lastPage, pages, cards,
             retracted, retractionChecked, kind, source, url, favicon, feedId,
             publishedTs, readingTime, archived
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func g<T: Decodable>(_ k: CodingKeys, _ d: T) -> T { (try? c.decode(T.self, forKey: k)) ?? d }
        func o<T: Decodable>(_ k: CodingKeys) -> T? { try? c.decode(T.self, forKey: k) }
        id = g(.id, UUID().uuidString)
        title = g(.title, "")
        authors = g(.authors, "")
        authorsFull = g(.authorsFull, "")
        year = g(.year, 0)
        venue = g(.venue, "")
        doi = g(.doi, "")
        arxiv = g(.arxiv, "")
        tags = g(.tags, [])
        read = g(.read, false)
        fav = g(.fav, false)
        added = g(.added, "")
        addedTs = g(.addedTs, 0)
        updatedTs = g(.updatedTs, 0)
        deleted = g(.deleted, false)
        abstract = g(.abstract, "")
        notes = g(.notes, "")
        hl = g(.hl, [])
        file = o(.file)
        summary = o(.summary)
        explainer = o(.explainer)
        markdown = o(.markdown)
        pdfUrl = o(.pdfUrl)
        status = o(.status)
        related = o(.related)
        concepts = o(.concepts)
        fulltext = o(.fulltext)
        lastPage = o(.lastPage)
        pages = o(.pages)
        cards = o(.cards)
        retracted = o(.retracted)
        retractionChecked = o(.retractionChecked)
        kind = o(.kind)
        source = o(.source)
        url = o(.url)
        favicon = o(.favicon)
        feedId = o(.feedId)
        publishedTs = o(.publishedTs)
        readingTime = o(.readingTime)
        archived = o(.archived)
    }
}

// The effective item kind, mirroring src/lib/items.ts: an explicit `kind`, else a
// paper if it has a DOI/arXiv id, else an article if it has a URL.
extension Paper {
    var itemKind: ItemKind {
        if let k = kind { return k }
        if !doi.isEmpty || !arxiv.isEmpty { return .paper }
        if url != nil { return .article }
        return .paper
    }
    var isArticle: Bool { itemKind == .article }
    var effectiveStatus: ReadingStatus { status ?? (read ? .done : .unread) }
}

// App settings — port of the Settings interface in src/lib/repo.ts. Lenient decode
// so new keys don't break older saved settings.
struct Settings: Hashable {
    // Personal-use defaults: the self-hosted backend URL + token are embedded so a
    // fresh install works with no setup. Both remain overridable in Settings.
    // Port 10000: the host's :443 is taken by another proxy, so Tailscale serves
    // the AI relay on :10000 (and the data/PDF server on :8443, derived below).
    static let defaultApiUrl = "https://oracle-india-2.tailb7083d.ts.net:10000"
    static let defaultApiToken = "0a2ab054fbe28042ba1529693a63a4053519fd09b9813d106374432f84b8a911"

    var theme: String = "light"
    var density: String = "compact"
    var view: String = "table"
    var defaultCite: String = "APA"
    var model: String = ""
    var embedProvider: String = "off"
    var embedModel: String = "voyage-3.5-lite"
    var voyageKey: String = ""
    var autoBib: Bool = false
    var apiUrl: String = Settings.defaultApiUrl
    var apiToken: String = Settings.defaultApiToken
    var syncAuto: Bool = false
    var lastSyncTs: Double = 0
    var webdavUrl: String = ""
    var webdavUser: String = ""
    var webdavPass: String = ""
    var syncPassphrase: String = ""
    /// Read-aloud (server Edge neural TTS): voice short-name + rate multiplier.
    var ttsProvider: String = "edge"
    var ttsVoice: String = "en-US-AriaNeural"
    var ttsRate: Double = 1.0
}

extension Settings: Codable {
    enum CodingKeys: String, CodingKey {
        case theme, density, view, defaultCite, model, embedProvider, embedModel,
             voyageKey, autoBib, apiUrl, apiToken, syncAuto, lastSyncTs,
             webdavUrl, webdavUser, webdavPass, syncPassphrase,
             ttsProvider, ttsVoice, ttsRate
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func g<T: Decodable>(_ k: CodingKeys, _ d: T) -> T { (try? c.decode(T.self, forKey: k)) ?? d }
        theme = g(.theme, "light")
        density = g(.density, "compact")
        view = g(.view, "table")
        defaultCite = g(.defaultCite, "APA")
        model = g(.model, "")
        embedProvider = g(.embedProvider, "off")
        embedModel = g(.embedModel, "voyage-3.5-lite")
        voyageKey = g(.voyageKey, "")
        autoBib = g(.autoBib, false)
        apiUrl = g(.apiUrl, Settings.defaultApiUrl)
        // Migrate the earlier port-443 URL (pre-:10000, which the host's Traefik
        // shadowed) to the working default — so an app updated in place, not just a
        // fresh install, picks up the fix automatically.
        if apiUrl == "https://oracle-india-2.tailb7083d.ts.net" || apiUrl.isEmpty {
            apiUrl = Settings.defaultApiUrl
        }
        apiToken = g(.apiToken, Settings.defaultApiToken)
        syncAuto = g(.syncAuto, false)
        lastSyncTs = g(.lastSyncTs, 0)
        webdavUrl = g(.webdavUrl, "")
        webdavUser = g(.webdavUser, "")
        webdavPass = g(.webdavPass, "")
        syncPassphrase = g(.syncPassphrase, "")
        ttsProvider = g(.ttsProvider, "edge")
        ttsVoice = g(.ttsVoice, "en-US-AriaNeural")
        ttsRate = g(.ttsRate, 1.0)
    }
}
