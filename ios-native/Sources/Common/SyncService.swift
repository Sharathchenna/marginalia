import Foundation

enum SyncError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

// A whole-library snapshot, the unit the WebDAV sync ships — mirrors the desktop
// snapshot the Tauri app PUTs/GETs (encrypted) to a user's own WebDAV server.
struct LibrarySnapshot: Codable {
    var papers: [Paper] = []
    var collections: [LibraryCollection] = []
    var feeds: [Feed] = []
    var ts: Double = 0
}

// Privacy-respecting cross-device sync against a user-hosted WebDAV target. The
// snapshot is E2E-encrypted on-device first (when a passphrase is set), so the
// server only ever sees ciphertext. Port of webdav_upload/download + crypto.ts.
struct SyncService {
    let url: String
    let user: String
    let pass: String
    let passphrase: String

    var isConfigured: Bool { !url.trimmingCharacters(in: .whitespaces).isEmpty }

    func push(_ snapshot: LibrarySnapshot) async throws {
        let data = try JSONEncoder().encode(snapshot)
        var body = String(decoding: data, as: UTF8.self)
        if !passphrase.isEmpty { body = try MargCrypto.encryptJSON(body, passphrase: passphrase) }
        guard let u = URL(string: url) else { throw SyncError.message("Invalid WebDAV URL.") }
        var req = URLRequest(url: u)
        req.httpMethod = "PUT"
        req.httpBody = body.data(using: .utf8)
        req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        addAuth(&req)
        let (_, resp) = try await URLSession.shared.data(for: req)
        try check(resp)
    }

    func pull() async throws -> LibrarySnapshot? {
        guard let u = URL(string: url) else { throw SyncError.message("Invalid WebDAV URL.") }
        var req = URLRequest(url: u)
        req.httpMethod = "GET"
        addAuth(&req)
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 404 { return nil }
            try check(resp)
        }
        var blob = String(decoding: data, as: UTF8.self)
        if MargCrypto.isEncrypted(blob) {
            guard !passphrase.isEmpty else { throw SyncError.message("This library is encrypted — set the sync passphrase.") }
            blob = try MargCrypto.decryptJSON(blob, passphrase: passphrase)
        }
        guard let d = blob.data(using: .utf8), let snap = try? JSONDecoder().decode(LibrarySnapshot.self, from: d) else {
            throw SyncError.message("Couldn't read the synced snapshot.")
        }
        return snap
    }

    private func addAuth(_ req: inout URLRequest) {
        guard !user.isEmpty else { return }
        let creds = Data("\(user):\(pass)".utf8).base64EncodedString()
        req.setValue("Basic \(creds)", forHTTPHeaderField: "Authorization")
    }
    private func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncError.message("WebDAV server returned HTTP \(http.statusCode).")
        }
    }
}
