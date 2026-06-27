import Foundation

// The data server's curated "latest LLM research" feed (GET /v1/feed/latest →
// Hugging Face daily papers, ranked by upvotes). Same self-hosted server as sync
// and PDFs (apiUrl host, port 8443).
enum LatestFeed {
    struct Item: Decodable, Identifiable {
        var arxiv: String
        var title: String
        var summary: String
        var authors: String
        var upvotes: Int
        var pdfUrl: String?
        var inLibrary: Bool
        var id: String { arxiv }

        /// A library Paper, keyed like arXiv discovery ("arxiv-<id>") so add/dedup match.
        func toPaper() -> Paper {
            var p = Paper(id: "arxiv-" + arxiv)
            p.title = title
            p.arxiv = arxiv
            p.doi = arxiv.isEmpty ? "" : "10.48550/arXiv.\(arxiv)"
            p.abstract = summary
            p.authorsFull = authors
            p.authors = authors
            p.venue = "arXiv"
            p.pdfUrl = pdfUrl
            p.kind = .paper
            p.addedTs = Date().timeIntervalSince1970 * 1000
            p.added = "just now"
            return p
        }
    }

    private struct Envelope: Decodable { var items: [Item] }

    static func fetch(apiUrl: String, token: String, limit: Int = 40) async throws -> [Item] {
        guard let base = PDFService.serverBase(apiUrl: apiUrl),
              var comp = URLComponents(string: base + "/v1/feed/latest") else { return [] }
        comp.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        guard let url = comp.url else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 25
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            throw NSError(domain: "LatestFeed", code: (resp as? HTTPURLResponse)?.statusCode ?? 0,
                          userInfo: [NSLocalizedDescriptionKey: "Feed unavailable. Check the server URL + token in Settings."])
        }
        return try JSONDecoder().decode(Envelope.self, from: data).items
    }
}
