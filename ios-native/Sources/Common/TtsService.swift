import Foundation
import AVFoundation

// Read-aloud via the self-hosted AI server's Edge-TTS route (POST /v1/tts/speak).
// Returns an mp3 the platform plays with AVAudioPlayer. Shared by iOS + macOS.
// The server lives at `apiUrl` (the AI relay port), same host as /v1/agent.
@MainActor
final class TtsService: NSObject, ObservableObject {
    enum State { case idle, loading, playing, paused }

    @Published private(set) var state: State = .idle

    private var player: AVAudioPlayer?
    private let session = URLSession(configuration: .default)

    struct Voice: Decodable, Identifiable, Hashable {
        let name: String
        let label: String
        let locale: String
        let gender: String
        var id: String { name }
    }

    private struct SpeakReq: Encodable { let text, voice, rate, pitch: String }
    private struct SpeakResp: Decodable { let ok: Bool; let audio: String?; let error: String? }
    private struct VoicesResp: Decodable { let ok: Bool; let voices: [Voice]? }

    /// Synthesize `text` and start playing. `rate` is an Edge percentage ("+0%").
    func speak(_ text: String, apiUrl: String, token: String,
               voice: String = "en-US-AriaNeural", rate: String = "+0%") async {
        stop()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = endpoint(apiUrl, "/v1/tts/speak") else { return }
        state = .loading
        do {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 60
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            // Edge caps payload size; keep the request to a sane chunk.
            let body = SpeakReq(text: String(trimmed.prefix(4000)), voice: voice, rate: rate, pitch: "+0Hz")
            req.httpBody = try JSONEncoder().encode(body)
            let (data, resp) = try await session.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { state = .idle; return }
            let decoded = try JSONDecoder().decode(SpeakResp.self, from: data)
            guard decoded.ok, let b64 = decoded.audio, let mp3 = Data(base64Encoded: b64) else {
                state = .idle; return
            }
            let p = try AVAudioPlayer(data: mp3)
            p.delegate = self
            p.prepareToPlay()
            player = p
            p.play()
            state = .playing
        } catch {
            state = .idle
        }
    }

    /// List available Edge voices (GET /v1/tts/voices).
    func voices(apiUrl: String, token: String) async -> [Voice] {
        guard let url = endpoint(apiUrl, "/v1/tts/voices") else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 30
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(VoicesResp.self, from: data) else { return [] }
        return decoded.voices ?? []
    }

    func pause() { player?.pause(); state = .paused }
    func resume() { player?.play(); state = .playing }
    func toggle(_ text: String, apiUrl: String, token: String, voice: String, rate: String) {
        switch state {
        case .playing: pause()
        case .paused: resume()
        default: Task { await speak(text, apiUrl: apiUrl, token: token, voice: voice, rate: rate) }
        }
    }
    func stop() {
        player?.stop()
        player = nil
        state = .idle
    }

    private func endpoint(_ apiUrl: String, _ path: String) -> URL? {
        let base = apiUrl.trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty else { return nil }
        return URL(string: base.hasSuffix("/") ? String(base.dropLast()) + path : base + path)
    }
}

extension TtsService: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.state = .idle }
    }
}
