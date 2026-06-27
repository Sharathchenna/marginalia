import Foundation
import CryptoKit
import CommonCrypto

// E2E encryption for the sync snapshot — byte-compatible with crypto.ts so an
// encrypted library round-trips with the desktop app. AES-256-GCM with a
// PBKDF2-SHA256 (200k) key; envelope { "marg-enc":1, salt, iv, ct } (base64).
enum MargCrypto {
    static func deriveKey(_ passphrase: String, salt: Data, iterations: Int = 200_000) -> SymmetricKey {
        var derived = [UInt8](repeating: 0, count: 32)
        let pw = Array(passphrase.utf8)
        let saltBytes = [UInt8](salt)
        _ = CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            pw.map { Int8(bitPattern: $0) }, pw.count,
            saltBytes, saltBytes.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
            &derived, derived.count
        )
        return SymmetricKey(data: Data(derived))
    }

    static func encryptJSON(_ plaintext: String, passphrase: String) throws -> String {
        let salt = Data((0..<16).map { _ in UInt8.random(in: UInt8.min...UInt8.max) })
        let key = deriveKey(passphrase, salt: salt)
        let nonce = AES.GCM.Nonce() // 12 bytes
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: key, nonce: nonce)
        let ct = sealed.ciphertext + sealed.tag // Web Crypto layout: ciphertext || tag
        let env: [String: Any] = [
            "marg-enc": 1,
            "salt": salt.base64EncodedString(),
            "iv": Data(nonce).base64EncodedString(),
            "ct": ct.base64EncodedString(),
        ]
        let data = try JSONSerialization.data(withJSONObject: env)
        return String(decoding: data, as: UTF8.self)
    }

    static func isEncrypted(_ blob: String) -> Bool {
        guard let d = blob.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        return (o["marg-enc"] as? Int) == 1
    }

    static func decryptJSON(_ blob: String, passphrase: String) throws -> String {
        guard let d = blob.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              (o["marg-enc"] as? Int) == 1 else { return blob } // already plaintext
        guard let salt = (o["salt"] as? String).flatMap({ Data(base64Encoded: $0) }),
              let iv = (o["iv"] as? String).flatMap({ Data(base64Encoded: $0) }),
              let ctTag = (o["ct"] as? String).flatMap({ Data(base64Encoded: $0) }),
              ctTag.count >= 16 else { throw SyncError.message("Corrupt encrypted snapshot.") }
        let key = deriveKey(passphrase, salt: salt)
        let tag = ctTag.suffix(16)
        let cipher = ctTag.prefix(ctTag.count - 16)
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: cipher, tag: tag)
            let pt = try AES.GCM.open(box, using: key)
            return String(decoding: pt, as: UTF8.self)
        } catch {
            throw SyncError.message("Wrong passphrase — couldn't decrypt the synced library.")
        }
    }
}
