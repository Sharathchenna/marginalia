import Foundation

// Fetch + parse an RSS or Atom feed into article Papers — native port of the feed
// half of metadata.rs / feeds.ts. Direct HTTP (no CORS, no server).
enum FeedService {
    struct Fetched { var title = ""; var site = ""; var posts: [Paper] = [] }

    static func fetch(_ urlString: String) async throws -> Fetched {
        guard let url = URL(string: urlString) else { throw LookupError.unrecognized }
        var req = URLRequest(url: url)
        req.setValue("Marginalia/1.0", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw LookupError.network("Feed returned HTTP \(http.statusCode).")
        }
        let parsed = FeedParser().parse(data)
        var out = Fetched(title: parsed.feedTitle, site: parsed.siteLink)
        out.posts = parsed.items.compactMap { it in
            guard !it.title.isEmpty || !it.link.isEmpty else { return nil }
            let key = it.id.isEmpty ? it.link : it.id
            var p = Paper(id: "feed-" + slug(key))
            p.title = it.title.isEmpty ? it.link : it.title
            p.url = it.link
            p.abstract = it.summary
            p.kind = .article
            p.source = .feed
            p.venue = host(it.link) ?? parsed.feedTitle
            let ts = parseDate(it.published)
            p.publishedTs = ts
            p.addedTs = ts ?? Date().timeIntervalSince1970 * 1000
            p.readingTime = readingTime(it.summary)
            return p
        }
        return out
    }

    private static func slug(_ s: String) -> String {
        let allowed = CharacterSet.alphanumerics
        let mapped = s.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        return String(String(mapped).prefix(120))
    }
    private static func host(_ urlString: String) -> String? {
        URL(string: urlString)?.host?.replacingOccurrences(of: "www.", with: "")
    }
    private static func readingTime(_ text: String) -> Double {
        let words = text.split(whereSeparator: { $0.isWhitespace }).count
        return max(1, Double(words) / 200.0)
    }
    private static func parseDate(_ s: String) -> Double? {
        if s.isEmpty { return nil }
        let fmts = ["EEE, dd MMM yyyy HH:mm:ss Z", "yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd"]
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        for f in fmts {
            df.dateFormat = f
            if let d = df.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        }
        let iso = ISO8601DateFormatter()
        if let d = iso.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        return nil
    }
}

// Handles both RSS (<item>) and Atom (<entry>) shapes.
final class FeedParser: NSObject, XMLParserDelegate {
    struct Item { var title = ""; var link = ""; var summary = ""; var published = ""; var id = "" }
    struct Result { var feedTitle = ""; var siteLink = ""; var items: [Item] = [] }

    private var result = Result()
    private var cur: Item?
    private var text = ""
    private var inItem = false

    func parse(_ data: Data) -> Result {
        let p = XMLParser(data: data)
        p.delegate = self
        p.parse()
        return result
    }

    func parser(_ p: XMLParser, didStartElement el: String, namespaceURI: String?, qualifiedName q: String?, attributes a: [String: String] = [:]) {
        text = ""
        let name = el.lowercased()
        if name == "item" || name == "entry" { inItem = true; cur = Item() }
        if name == "link", let href = a["href"], !href.isEmpty {
            if inItem { if (cur?.link ?? "").isEmpty { cur?.link = href } }
            else if result.siteLink.isEmpty { result.siteLink = href }
        }
    }
    func parser(_ p: XMLParser, foundCharacters string: String) { text += string }
    func parser(_ p: XMLParser, didEndElement el: String, namespaceURI: String?, qualifiedName q: String?) {
        let name = el.lowercased()
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if inItem {
            switch name {
            case "title": if (cur?.title ?? "").isEmpty { cur?.title = t }
            case "link": if (cur?.link ?? "").isEmpty, !t.isEmpty { cur?.link = t }
            case "description", "summary", "content", "content:encoded":
                if (cur?.summary ?? "").isEmpty { cur?.summary = strip(t) }
            case "pubdate", "published", "updated", "dc:date":
                if (cur?.published ?? "").isEmpty { cur?.published = t }
            case "guid", "id": if (cur?.id ?? "").isEmpty { cur?.id = t }
            case "item", "entry": if let c = cur { result.items.append(c) }; cur = nil; inItem = false
            default: break
            }
        } else {
            switch name {
            case "title": if result.feedTitle.isEmpty { result.feedTitle = t }
            case "link": if result.siteLink.isEmpty, !t.isEmpty { result.siteLink = t }
            default: break
            }
        }
        text = ""
    }
    private func strip(_ s: String) -> String {
        s.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
