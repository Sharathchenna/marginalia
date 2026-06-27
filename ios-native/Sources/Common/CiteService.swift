import Foundation

// Full CSL/citeproc citation formatting via the self-hosted AI server
// (POST /v1/cite), with the dependency-free Citation.format as an offline
// fallback. Gives the desktop's journal styles (IEEE, Nature, ACM, AMA, Harvard…)
// on top of APA/MLA/Chicago/BibTeX. Shared by iOS + macOS.
enum CiteService {
    // The styles the server exposes (mirrors /v1/cite/styles); used for the picker.
    static let styles: [(id: String, label: String)] = [
        ("APA", "APA"),
        ("MLA", "MLA"),
        ("Chicago", "Chicago"),
        ("ieee", "IEEE"),
        ("nature", "Nature"),
        ("harvard-cite-them-right", "Harvard"),
        ("american-medical-association", "AMA"),
        ("association-for-computing-machinery", "ACM"),
        ("BibTeX", "BibTeX"),
    ]

    private struct Req: Encodable { let paper: Paper; let style: String }
    private struct Resp: Decodable { let ok: Bool; let text: String?; let html: String? }

    /// Format `paper` in `style`. Tries the server (full CSL); on any failure falls
    /// back to the local deterministic formatter so it always returns something.
    static func format(_ paper: Paper, style: String, apiUrl: String, token: String) async -> String {
        if let server = try? await remote(paper, style: style, apiUrl: apiUrl, token: token),
           !server.isEmpty {
            return server
        }
        return Citation.format(paper, style: localStyle(style))
    }

    private static func remote(_ paper: Paper, style: String, apiUrl: String, token: String) async throws -> String? {
        let base = apiUrl.trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty,
              let url = URL(string: (base.hasSuffix("/") ? String(base.dropLast()) : base) + "/v1/cite")
        else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONEncoder().encode(Req(paper: paper, style: style))
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let decoded = try JSONDecoder().decode(Resp.self, from: data)
        return decoded.ok ? decoded.text : nil
    }

    // Map server style ids onto the local formatter's 4 supported styles.
    private static func localStyle(_ style: String) -> String {
        switch style {
        case "BibTeX": return "BibTeX"
        case "MLA": return "MLA"
        case "Chicago", "chicago-author-date": return "Chicago"
        default: return "APA"
        }
    }
}
