import Foundation

// Search arXiv for new papers — native port of the discover.ts arXiv path.
enum DiscoverService {
    static func search(_ query: String) async throws -> [Paper] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let urlStr = "https://export.arxiv.org/api/query?search_query=all:\(q)&start=0&max_results=25&sortBy=relevance"
        guard let url = URL(string: urlStr) else { throw LookupError.unrecognized }
        var req = URLRequest(url: url)
        req.setValue("Marginalia/1.0", forHTTPHeaderField: "User-Agent")
        let (data, _) = try await URLSession.shared.data(for: req)
        return ArxivEntriesParser().parse(data).map { e in
            var p = Paper(id: "arxiv-" + e.arxivId)
            p.title = e.title
            p.arxiv = e.arxivId
            p.doi = e.arxivId.isEmpty ? "" : "10.48550/arXiv.\(e.arxivId)"
            p.abstract = e.summary
            p.authorsFull = e.authors.joined(separator: ", ")
            p.authors = shortAuthors(e.authors)
            p.year = Int(e.published.prefix(4)) ?? 0
            p.venue = "arXiv"
            p.pdfUrl = e.arxivId.isEmpty ? nil : "https://arxiv.org/pdf/\(e.arxivId)"
            p.kind = .paper
            p.addedTs = Date().timeIntervalSince1970 * 1000
            p.added = "just now"
            return p
        }
    }

    private static func shortAuthors(_ names: [String]) -> String {
        guard let first = names.first else { return "" }
        let last = first.split(separator: " ").last.map(String.init) ?? first
        return names.count > 1 ? "\(last) et al." : last
    }
}

// Collects every <entry> from an arXiv Atom feed.
final class ArxivEntriesParser: NSObject, XMLParserDelegate {
    struct Entry { var title = ""; var summary = ""; var published = ""; var authors: [String] = []; var arxivId = "" }

    private var entries: [Entry] = []
    private var cur: Entry?
    private var inAuthor = false
    private var text = ""

    func parse(_ data: Data) -> [Entry] {
        let p = XMLParser(data: data)
        p.delegate = self
        p.parse()
        return entries
    }

    func parser(_ p: XMLParser, didStartElement el: String, namespaceURI: String?, qualifiedName q: String?, attributes a: [String: String] = [:]) {
        text = ""
        if el == "entry" { cur = Entry() }
        if el == "author" { inAuthor = true }
    }
    func parser(_ p: XMLParser, foundCharacters string: String) { text += string }
    func parser(_ p: XMLParser, didEndElement el: String, namespaceURI: String?, qualifiedName q: String?) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cur != nil else { text = ""; return }
        switch el {
        case "title": if cur!.title.isEmpty { cur!.title = collapse(t) }
        case "summary": if cur!.summary.isEmpty { cur!.summary = collapse(t) }
        case "published": if cur!.published.isEmpty { cur!.published = t }
        case "id": if cur!.arxivId.isEmpty { cur!.arxivId = arxivId(from: t) }
        case "name": if inAuthor, !t.isEmpty { cur!.authors.append(t) }
        case "author": inAuthor = false
        case "entry": if let c = cur { entries.append(c) }; cur = nil
        default: break
        }
        text = ""
    }
    private func collapse(_ s: String) -> String {
        s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }
    private func arxivId(from idURL: String) -> String {
        guard let r = idURL.range(of: "abs/") else { return "" }
        return String(idURL[r.upperBound...]).replacingOccurrences(of: #"v\d+$"#, with: "", options: .regularExpression)
    }
}
