import Foundation

// Per-record sync against the self-hosted data server (server-rs: GET /v1/sync +
// CRUD). The server is the source of truth; this pushes local changes and pulls
// deltas (last-writer-wins on `updatedTs`, with tombstones). It runs on the same
// server the app already uses for PDFs and AI — base derived via PDFService.
struct RemoteSync {
    let base: String   // data server base, e.g. https://host:8443
    let token: String

    var isConfigured: Bool { !base.isEmpty }

    /// The aggregate pull envelope returned by GET /v1/sync.
    struct Pulled: Decodable {
        var serverTs: Double
        var papers: [Paper]
        var collections: [LibraryCollection]?
        var collectionsTs: Double?
        var feeds: [Feed]?
        var feedsTs: Double?
    }

    private func request(_ path: String, _ method: String = "GET") -> URLRequest {
        var r = URLRequest(url: URL(string: base + path)!)
        r.httpMethod = method
        r.timeoutInterval = 30
        if !token.isEmpty { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return r
    }

    func pull(since: Double) async throws -> Pulled {
        let (data, resp) = try await URLSession.shared.data(for: request("/v1/sync?since=\(Int64(since))"))
        try check(resp)
        return try JSONDecoder().decode(Pulled.self, from: data)
    }

    func pushPaper(_ p: Paper) async throws {
        var r = request("/v1/papers", "POST")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(p)
        let (_, resp) = try await URLSession.shared.data(for: r)
        try check(resp)
    }

    func deletePaper(_ id: String) async throws {
        let (_, resp) = try await URLSession.shared.data(for: request("/v1/papers/\(id)", "DELETE"))
        try check(resp)
    }

    func putCollections(_ c: [LibraryCollection]) async throws { try await putJSON("/v1/collections", c) }
    func putFeeds(_ f: [Feed]) async throws { try await putJSON("/v1/feeds", f) }

    private func putJSON<T: Encodable>(_ path: String, _ value: T) async throws {
        var r = request(path, "PUT")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(value)
        let (_, resp) = try await URLSession.shared.data(for: r)
        try check(resp)
    }

    private func check(_ resp: URLResponse) throws {
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "RemoteSync", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "Sync server error (\(code))."])
        }
    }
}
