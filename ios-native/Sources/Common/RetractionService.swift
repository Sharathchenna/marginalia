import Foundation

// Privacy-preserving retraction check against the data server's Retraction Watch
// route (GET /v1/retraction?doi=). Only the DOI is sent. Mirrors the desktop
// check_retraction. The data server is on the apiUrl host, port 8443.
enum RetractionService {
    private struct Resp: Decodable {
        let retracted: Bool
        let type: String?
        let reason: String?
        let date: String?
        let url: String?
    }

    /// Returns a Retraction if the DOI is flagged, else nil. Throws on network error.
    static func check(doi: String, apiUrl: String, token: String) async throws -> Retraction? {
        let id = doi.trimmingCharacters(in: .whitespaces)
        guard !id.isEmpty, id != "—",
              let base = PDFService.serverBase(apiUrl: apiUrl),
              var comps = URLComponents(string: "\(base)/v1/retraction") else { return nil }
        comps.queryItems = [URLQueryItem(name: "doi", value: id)]
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let decoded = try JSONDecoder().decode(Resp.self, from: data)
        guard decoded.retracted else { return nil }
        return Retraction(type: decoded.type ?? "retraction",
                          reason: decoded.reason ?? "",
                          date: decoded.date ?? "",
                          url: decoded.url ?? "")
    }
}
