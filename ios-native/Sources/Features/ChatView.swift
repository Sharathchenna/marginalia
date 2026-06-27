import SwiftUI

struct ChatMessage: Identifiable {
    let id = UUID()
    var role: String   // user | assistant
    var text: String
}

// AI chat — "Chat about this paper" (paper != nil) or "Ask your library"
// (paper == nil). Streams from the self-hosted backend over SSE. Mirrors
// ChatPanel.tsx.
struct ChatView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paper: Paper?

    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var streaming = false
    @State private var thinking = false
    @State private var streamTask: Task<Void, Never>?

    private var service: ChatService {
        ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !service.isConfigured {
                    ContentUnavailableView {
                        Label("No AI backend", systemImage: "bolt.slash")
                    } description: {
                        Text("Set an AI backend URL and token in Settings to chat. AI runs on your self-hosted server.")
                    }
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                if messages.isEmpty {
                                    Text(paper == nil ? "Ask anything about your library." : "Ask anything about this paper.")
                                        .foregroundStyle(.secondary).font(.callout).padding(.top, 24)
                                }
                                ForEach(messages) { m in MessageBubble(message: m) }
                                if thinking {
                                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Thinking…").font(.caption).foregroundStyle(.secondary) }
                                }
                                Color.clear.frame(height: 1).id("bottom")
                            }
                            .padding()
                        }
                        .onChange(of: messages.last?.text) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                    }
                    inputBar
                }
            }
            .navigationTitle(paper == nil ? "Ask your library" : "Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { streamTask?.cancel(); dismiss() } } }
            .task {
                // Dev hook: MARG_CHAT_TEST=<question> auto-sends to exercise streaming.
                if let q = ProcessInfo.processInfo.environment["MARG_CHAT_TEST"], service.isConfigured, messages.isEmpty {
                    input = q; send()
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField(paper == nil ? "Ask about your library…" : "Ask about this paper…", text: $input, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(1...4)
            Button { send() } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || streaming)
        }
        .padding()
        .background(.bar)
    }

    private func send() {
        let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !streaming else { return }
        let history = messages.map { ["role": $0.role, "text": $0.text] }
        messages.append(ChatMessage(role: "user", text: q))
        messages.append(ChatMessage(role: "assistant", text: ""))
        let idx = messages.count - 1
        input = ""
        streaming = true; thinking = false

        let payload: [String: Any]
        if let p = paper {
            payload = ["mode": "chat", "question": q, "paper": p.payloadDict, "history": history]
        } else {
            let ctx: [[String: Any]] = model.papers.prefix(40).map { p in
                ["title": p.title, "authors": p.authors, "year": p.year, "venue": p.venue,
                 "abstract": p.abstract, "summary": p.summary ?? ""]
            }
            payload = ["mode": "library", "papers": ctx, "question": q, "history": history]
        }

        streamTask = Task {
            for await ev in service.stream(payload) {
                switch ev {
                case .delta(let t): if idx < messages.count { messages[idx].text += t; thinking = false }
                case .thinkingStart, .thinking: thinking = true
                case .done: streaming = false; thinking = false
                case .error(let m):
                    if idx < messages.count {
                        let prefix = messages[idx].text.isEmpty ? "" : "\n\n"
                        messages[idx].text += prefix + "⚠️ " + m
                    }
                    streaming = false; thinking = false
                default: break
                }
            }
            streaming = false; thinking = false
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    var body: some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }
            Text(message.text.isEmpty ? " " : LocalizedStringKey(message.text))
                .font(.callout)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(
                    message.role == "user" ? Color.accentColor.opacity(0.9) : Color(.secondarySystemBackground),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .foregroundStyle(message.role == "user" ? .white : .primary)
                .textSelection(.enabled)
            if message.role == "assistant" { Spacer(minLength: 40) }
        }
    }
}
