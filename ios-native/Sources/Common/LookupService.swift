import Foundation

// Resolve a DOI / arXiv id / URL into a Paper — native port of metadata.rs.
// Runs direct HTTP from the device (no CORS), so no server is required.
enum LookupError: LocalizedError {
    case unrecognized, notFound, network(String)
    var errorDescription: String? {
        switch self {
        case .unrecognized: return "Unrecognized identifier — paste a DOI, arXiv id, or URL."
        case .notFound: return "Couldn't find metadata for that identifier."
        case .network(let m): return m
        }
    }
}

enum LookupService {
    static func lookup(_ identifier: String) async throws -> Paper {
        let s = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = arxivId(s) { return try await fetchArxiv(id) }
        if let doi = doiId(s) { return try await fetchDOI(doi) }
        throw LookupError.unrecognized
    }

    // MARK: identifier detection (port of metadata.rs)

    static func arxivId(_ s: String) -> String? {
        if let r = s.range(of: "arxiv.org/abs/") { return stripVersion(String(s[r.upperBound...])) }
        let lower = s.lowercased()
        if lower.hasPrefix("arxiv:") { return stripVersion(String(s.dropFirst(6)).trimmingCharacters(in: .whitespaces)) }
        // bare modern id: 1706.03762 or 2310.06825v2 (and NOT a DOI, which has '/')
        if !s.contains("/"), let m = s.range(of: #"^\d{4}\.\d{4,5}(v\d+)?$"#, options: .regularExpression) {
            return stripVersion(String(s[m]))
        }
        return nil
    }

    static func doiId(_ s: String) -> String? {
        if let r = s.range(of: #"10\.\d{4,9}/[^\s"<>]+"#, options: .regularExpression) {
            return String(s[r]).trimmingCharacters(in: CharacterSet(charactersIn: ".,);]"))
        }
        return nil
    }

    private static func stripVersion(_ s: String) -> String {
        s.replacingOccurrences(of: #"v\d+$"#, with: "", options: .regularExpression)
    }

    // MARK: arXiv (Atom API)

    static func fetchArxiv(_ id: String) async throws -> Paper {
        let url = URL(string: "https://export.arxiv.org/api/query?id_list=\(id)&max_results=1")!
        let data = try await get(url)
        let p = ArxivParser()
        guard let entry = p.parse(data), !entry.title.isEmpty else { throw LookupError.notFound }
        var paper = Paper(id: "arxiv-" + id)
        paper.title = entry.title
        paper.arxiv = id
        paper.doi = "10.48550/arXiv.\(id)"
        paper.abstract = entry.summary
        paper.authorsFull = entry.authors.joined(separator: ", ")
        paper.authors = shortAuthors(entry.authors)
        paper.year = Int(entry.published.prefix(4)) ?? 0
        paper.venue = "arXiv"
        paper.pdfUrl = "https://arxiv.org/pdf/\(id)"
        paper.kind = .paper
        stamp(&paper)
        return paper
    }

    // MARK: DOI (Crossref)

    static func fetchDOI(_ doi: String) async throws -> Paper {
        let enc = doi.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? doi
        let url = URL(string: "https://api.crossref.org/works/\(enc)")!
        let data = try await get(url)
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let msg = root["message"] as? [String: Any] else { throw LookupError.notFound }
        var paper = Paper(id: "doi-" + doi.replacingOccurrences(of: "/", with: "_"))
        paper.doi = doi
        if let titles = msg["title"] as? [String], let t = titles.first { paper.title = t }
        if let authors = msg["author"] as? [[String: Any]] {
            let names = authors.map { a -> String in
                let g = a["given"] as? String ?? ""
                let f = a["family"] as? String ?? ""
                return [g, f].filter { !$0.isEmpty }.joined(separator: " ")
            }.filter { !$0.isEmpty }
            paper.authorsFull = names.joined(separator: ", ")
            paper.authors = shortAuthors(names)
        }
        if let cont = msg["container-title"] as? [String], let v = cont.first { paper.venue = v }
        if let issued = msg["issued"] as? [String: Any],
           let parts = issued["date-parts"] as? [[Int]], let first = parts.first, let y = first.first {
            paper.year = y
        }
        if let abs = msg["abstract"] as? String { paper.abstract = stripJATS(abs) }
        paper.kind = .paper
        stamp(&paper)
        guard !paper.title.isEmpty else { throw LookupError.notFound }
        return paper
    }

    // MARK: web page clip

    static func clipWebpage(_ urlString: String) async throws -> Paper {
        guard let url = URL(string: urlString) else { throw LookupError.unrecognized }
        let data = try await get(url)
        let html = String(data: data, encoding: .utf8) ?? ""
        var paper = Paper(id: "web-" + UUID().uuidString.prefix(8))
        paper.title = firstMatch(html, #"<title[^>]*>([^<]+)</title>"#) ?? url.host ?? urlString
        paper.abstract = metaContent(html, name: "description") ?? metaContent(html, property: "og:description") ?? ""
        paper.url = urlString
        paper.kind = .article
        paper.source = .clip
        paper.venue = url.host?.replacingOccurrences(of: "www.", with: "") ?? ""
        stamp(&paper)
        return paper
    }

    // MARK: helpers

    private static func get(_ url: URL) async throws -> Data {
        var req = URLRequest(url: url)
        req.setValue("Marginalia/1.0 (mailto:hello@marginalia.app)", forHTTPHeaderField: "User-Agent")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 404 { throw LookupError.notFound }
            return data
        } catch let e as LookupError { throw e }
        catch { throw LookupError.network(error.localizedDescription) }
    }

    private static func shortAuthors(_ names: [String]) -> String {
        guard let first = names.first else { return "" }
        let last = first.split(separator: " ").last.map(String.init) ?? first
        return names.count > 1 ? "\(last) et al." : last
    }

    private static func stamp(_ p: inout Paper) {
        p.addedTs = Date().timeIntervalSince1970 * 1000
        p.added = "just now"
    }

    private static func stripJATS(_ s: String) -> String {
        s.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstMatch(_ s: String, _ pattern: String) -> String? {
        guard let r = s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let inner = String(s[r])
        guard let open = inner.range(of: ">"), let close = inner.range(of: "<", range: open.upperBound..<inner.endIndex) else { return nil }
        return String(inner[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func metaContent(_ html: String, name: String) -> String? {
        firstAttr(html, #"<meta[^>]*name=[\"']\#(name)[\"'][^>]*content=[\"']([^\"']*)[\"']"#)
    }
    private static func metaContent(_ html: String, property: String) -> String? {
        firstAttr(html, #"<meta[^>]*property=[\"']\#(property)[\"'][^>]*content=[\"']([^\"']*)[\"']"#)
    }
    private static func firstAttr(_ s: String, _ pattern: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
        let range = NSRange(s.startIndex..., in: s)
        guard let m = re.firstMatch(in: s, range: range), m.numberOfRanges > 1,
              let r = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[r])
    }
}

// Minimal Atom parser for the first arXiv entry.
final class ArxivParser: NSObject, XMLParserDelegate {
    struct Entry { var title = ""; var summary = ""; var published = ""; var authors: [String] = [] }
    private var entry = Entry()
    private var inEntry = false
    private var inAuthor = false
    private var current = ""
    private var buf = ""

    func parse(_ data: Data) -> Entry? {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse() // return value is unreliable once we abortParsing(); use the captured entry
        return entry.title.isEmpty ? nil : entry
    }

    func parser(_ p: XMLParser, didStartElement el: String, namespaceURI: String?, qualifiedName q: String?, attributes: [String: String] = [:]) {
        current = el; buf = ""
        if el == "entry" { inEntry = true }
        if el == "author" { inAuthor = true }
    }
    func parser(_ p: XMLParser, foundCharacters string: String) { buf += string }
    func parser(_ p: XMLParser, didEndElement el: String, namespaceURI: String?, qualifiedName q: String?) {
        let text = buf.trimmingCharacters(in: .whitespacesAndNewlines)
        guard inEntry else { if el == "entry" { inEntry = false }; return }
        switch el {
        case "title": if entry.title.isEmpty { entry.title = collapse(text) }
        case "summary": if entry.summary.isEmpty { entry.summary = collapse(text) }
        case "published": if entry.published.isEmpty { entry.published = text }
        case "name": if inAuthor, !text.isEmpty { entry.authors.append(text) }
        case "author": inAuthor = false
        case "entry": inEntry = false; p.abortParsing()
        default: break
        }
        buf = ""
    }
    private func collapse(_ s: String) -> String {
        s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }
}
