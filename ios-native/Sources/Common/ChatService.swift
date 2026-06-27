import Foundation

// One streamed event from the AI backend — mirrors applyAgentEvent in agent.ts.
enum AgentEvent {
    case delta(String)
    case thinkingStart
    case thinking(String)
    case tool(name: String?, phase: String)
    case metadata([String: Any])
    case tags([String: Any])
    case verdict([String: Any])
    case done(cost: Double?, model: String?)
    case error(String)

    init?(_ p: [String: Any]) {
        switch p["type"] as? String {
        case "delta": self = .delta(p["text"] as? String ?? "")
        case "thinking_start": self = .thinkingStart
        case "thinking": self = .thinking(p["text"] as? String ?? "")
        case "tool": self = .tool(name: p["name"] as? String, phase: p["phase"] as? String ?? "start")
        case "metadata": self = .metadata(p["data"] as? [String: Any] ?? [:])
        case "tags": self = .tags(p["data"] as? [String: Any] ?? [:])
        case "verdict": self = .verdict(p["data"] as? [String: Any] ?? [:])
        case "done":
            if (p["isError"] as? Bool) == true { self = .error(p["error"] as? String ?? "The model reported an error.") }
            else { self = .done(cost: p["cost"] as? Double, model: p["model"] as? String) }
        case "error": self = .error(p["error"] as? String ?? "Unknown error")
        default: return nil
        }
    }
}

// Client for the self-hosted AI backend (server/server.mjs). POSTs a payload and
// parses the SSE stream — the native port of runAgentRemote in agent.ts.
struct ChatService {
    let baseURL: String
    let token: String
    let model: String

    var isConfigured: Bool { !baseURL.trimmingCharacters(in: .whitespaces).isEmpty }

    func stream(_ payload: [String: Any]) -> AsyncStream<AgentEvent> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    let base = baseURL.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
                    guard let url = URL(string: base + "/v1/agent") else {
                        continuation.yield(.error("Invalid AI backend URL.")); continuation.finish(); return
                    }
                    var body = payload
                    if !model.isEmpty, body["model"] == nil { body["model"] = model }
                    var req = URLRequest(url: url)
                    req.httpMethod = "POST"
                    req.timeoutInterval = 120
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
                    req.httpBody = try JSONSerialization.data(withJSONObject: body)

                    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                    guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                        continuation.yield(.error("AI backend error (\(code)). Check the URL and token in Settings."))
                        continuation.finish(); return
                    }
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let json = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        guard !json.isEmpty, let data = json.data(using: .utf8),
                              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let event = AgentEvent(obj) else { continue }
                        continuation.yield(event)
                        switch event {
                        case .done, .error: continuation.finish(); return
                        default: break
                        }
                    }
                    continuation.finish()
                } catch {
                    if !Task.isCancelled { continuation.yield(.error(error.localizedDescription)) }
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

extension Paper {
    // Encode to the JSON dict shape the agent sidecar expects.
    var payloadDict: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}
