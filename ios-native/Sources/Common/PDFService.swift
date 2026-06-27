import Foundation
import PDFKit

// Resolves where a paper's PDF lives. Real PDFs arrive via import (Phase D) or
// download from the server (Phase G) and are cached under Application Support;
// the bundled sample lets the reader be exercised against the seed library.
enum PDFService {
    static var cacheDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Marginalia/pdfs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func cachedURL(for id: String) -> URL? {
        let u = cacheDir.appendingPathComponent("\(id).pdf")
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    /// Copy the bundled sample in as this paper's PDF (used to exercise the reader
    /// on the seed library; the real app imports/downloads instead).
    @discardableResult
    static func attachSample(to id: String) -> URL? {
        guard let src = Bundle.main.url(forResource: "sample", withExtension: "pdf") else { return nil }
        let dst = cacheDir.appendingPathComponent("\(id).pdf")
        if !FileManager.default.fileExists(atPath: dst.path) {
            try? FileManager.default.copyItem(at: src, to: dst)
        }
        return cachedURL(for: id)
    }

    /// Base URL of the self-hosted data server (PDF object store). It lives on the
    /// same host as the AI backend, on port 8443. nil when no backend is set.
    static func serverBase(apiUrl: String) -> String? {
        let trimmed = apiUrl.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, var c = URLComponents(string: trimmed), c.host != nil else { return nil }
        c.port = 8443
        c.path = ""
        c.query = nil
        return c.string
    }

    /// Download a paper's PDF from the data server (GET /v1/pdf/{id}) and cache it.
    static func downloadFromServer(id: String, apiUrl: String, token: String) async -> URL? {
        guard let base = serverBase(apiUrl: apiUrl), let url = URL(string: "\(base)/v1/pdf/\(id)") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20 // fail fast if the server/PDF is unreachable
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200, !data.isEmpty else { return nil }
            let dst = cacheDir.appendingPathComponent("\(id).pdf")
            try data.write(to: dst, options: .atomic)
            return dst
        } catch {
            return nil
        }
    }

    /// Upload a paper's PDF to the data server (PUT /v1/pdf/{id}) so every device
    /// serves it from there instead of a one-off local import.
    @discardableResult
    static func uploadToServer(_ localURL: URL, id: String, apiUrl: String, token: String) async -> Bool {
        guard let base = serverBase(apiUrl: apiUrl), let url = URL(string: "\(base)/v1/pdf/\(id)"),
              let data = try? Data(contentsOf: localURL) else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.timeoutInterval = 60
        req.setValue("application/pdf", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            let (_, resp) = try await URLSession.shared.upload(for: req, from: data)
            return (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        } catch {
            return false
        }
    }

    /// Download a remote PDF (pdfUrl) and cache it. Native HTTP — no CORS.
    static func download(_ urlString: String, for id: String) async -> URL? {
        guard let url = URL(string: urlString) else { return nil }
        do {
            let (data, resp) = try await URLSession.shared.data(from: url)
            guard (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { return nil }
            let dst = cacheDir.appendingPathComponent("\(id).pdf")
            try data.write(to: dst, options: .atomic)
            return dst
        } catch {
            return nil
        }
    }

    /// Extract the full body text of a PDF (for grounding the AI explainer).
    /// Returns nil for image-only/scanned PDFs with no embedded text.
    static func extractText(_ url: URL) -> String? {
        guard let doc = PDFDocument(url: url), let s = doc.string else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Import a user-picked PDF file into the cache for a paper.
    @discardableResult
    static func importFile(_ src: URL, for id: String) -> URL? {
        let dst = cacheDir.appendingPathComponent("\(id).pdf")
        let needStop = src.startAccessingSecurityScopedResource()
        defer { if needStop { src.stopAccessingSecurityScopedResource() } }
        try? FileManager.default.removeItem(at: dst)
        do { try FileManager.default.copyItem(at: src, to: dst); return dst } catch { return nil }
    }
}
