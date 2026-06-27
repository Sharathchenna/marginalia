import Foundation

// Semantic search over the library via the data server's Voyage-backed routes
// (POST /v1/embed, GET /v1/semantic, GET /v1/embed/status). The server stores the
// vectors and computes cosine similarity; the app just sends paper texts to index
// and queries by text. Mirrors the desktop semantic_search. Data server = :8443.
enum SearchService {
    struct Status: Decodable { let embedded: Int; let model: String; let hasKey: Bool }
    private struct Hit: Decodable { let id: String; let score: Double }
    private struct EmbedItem: Encodable { let id: String; let text: String }
    private struct EmbedBody: Encodable { let items: [EmbedItem] }

    /// How many papers are embedded + whether the server has a Voyage key.
    static func status(apiUrl: String, token: String) async -> Status? {
        guard let url = endpoint(apiUrl, "/v1/embed/status") else { return nil }
        var req = URLRequest(url: url); req.timeoutInterval = 15
        auth(&req, token)
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(Status.self, from: data)
    }

    /// Push the Voyage key into the server settings so it can embed (settings are
    /// not synced, so this is an explicit opt-in step before indexing).
    static func setVoyageKey(_ key: String, apiUrl: String, token: String) async {
        guard let url = endpoint(apiUrl, "/v1/settings") else { return }
        var req = URLRequest(url: url); req.httpMethod = "PUT"; req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        auth(&req, token)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["voyageKey": key])
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Index (embed) the given papers. Unchanged papers are skipped server-side.
    @discardableResult
    static func index(_ papers: [Paper], apiUrl: String, token: String) async -> Int {
        guard let url = endpoint(apiUrl, "/v1/embed") else { return 0 }
        let items = papers.filter { !$0.deleted }.map {
            EmbedItem(id: $0.id, text: [$0.title, $0.authors, $0.venue, $0.abstract].joined(separator: ". "))
        }
        guard !items.isEmpty else { return 0 }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 120
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        auth(&req, token)
        req.httpBody = try? JSONEncoder().encode(EmbedBody(items: items))
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return 0 }
        return (obj["embedded"] as? Int) ?? 0
    }

    /// Semantic search → paper ids ranked by similarity (best first).
    static func semantic(_ query: String, apiUrl: String, token: String, k: Int = 30) async -> [String] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let base = PDFService.serverBase(apiUrl: apiUrl),
              var comps = URLComponents(string: "\(base)/v1/semantic") else { return [] }
        comps.queryItems = [URLQueryItem(name: "q", value: q), URLQueryItem(name: "k", value: String(k))]
        guard let url = comps.url else { return [] }
        var req = URLRequest(url: url); req.timeoutInterval = 25
        auth(&req, token)
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let hits = try? JSONDecoder().decode([Hit].self, from: data) else { return [] }
        return hits.map { $0.id }
    }

    private static func endpoint(_ apiUrl: String, _ path: String) -> URL? {
        guard let base = PDFService.serverBase(apiUrl: apiUrl) else { return nil }
        return URL(string: base + path)
    }
    private static func auth(_ req: inout URLRequest, _ token: String) {
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    }
}
