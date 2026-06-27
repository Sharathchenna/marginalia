import SwiftUI

// Chat about a paper (or the whole library when paper == nil) via the AI relay's
// SSE stream. Mirrors ChatView. Presented as a sheet.
struct MacChatView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paper: Paper?

    struct Msg: Identifiable { let id = UUID(); let role: String; var text: String }

    @State private var input = ""
    @State private var messages: [Msg] = []
    @State private var streaming = false
    @State private var thinking = false

    private var service: ChatService {
        ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(paper == nil ? "Chat with your library" : "Chat about this paper").font(.headline)
                Spacer()
                Button("Done") { dismiss() }
            }
            .padding(12)
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            Text(paper == nil
                                 ? "Ask about themes, comparisons, or what to read next."
                                 : "Ask anything about “\(paper?.title ?? "")”.")
                                .foregroundStyle(.secondary).padding()
                        }
                        ForEach(messages) { m in bubble(m) }
                        if thinking { Label("Thinking…", systemImage: "ellipsis").foregroundStyle(.secondary) }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(12)
                }
                .onChange(of: messages.last?.text) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }

            Divider()
            HStack {
                TextField("Message…", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...4)
                    .onSubmit { send() }
                Button { send() } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .buttonStyle(.plain)
                    .disabled(streaming || input.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
        }
        .frame(width: 560, height: 560)
    }

    private func bubble(_ m: Msg) -> some View {
        HStack {
            if m.role == "user" { Spacer(minLength: 40) }
            Group {
                if m.role == "user" {
                    Text(m.text).padding(10).background(.tint, in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.white)
                } else {
                    MacMarkdownText(text: m.text.isEmpty ? "…" : m.text)
                        .padding(10).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            if m.role != "user" { Spacer(minLength: 40) }
        }
        .textSelection(.enabled)
    }

    private func send() {
        let q = input.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !streaming else { return }
        let history = messages.map { ["role": $0.role, "text": $0.text] }
        messages.append(Msg(role: "user", text: q))
        messages.append(Msg(role: "assistant", text: ""))
        let idx = messages.count - 1
        input = ""; streaming = true; thinking = true

        let payload: [String: Any]
        if let p = paper {
            payload = ["mode": "chat", "question": q, "paper": p.payloadDict, "history": history]
        } else {
            let ctx: [[String: Any]] = model.papers.prefix(40).map { p in
                ["title": p.title, "authors": p.authors, "year": p.year, "venue": p.venue, "abstract": p.abstract]
            }
            payload = ["mode": "library", "papers": ctx, "question": q, "history": history]
        }

        Task {
            for await ev in service.stream(payload) {
                switch ev {
                case .delta(let t): if idx < messages.count { messages[idx].text += t; thinking = false }
                case .thinkingStart, .thinking: thinking = true
                case .done: streaming = false; thinking = false
                case .error(let m):
                    if idx < messages.count {
                        let pfx = messages[idx].text.isEmpty ? "" : "\n\n"
                        messages[idx].text += pfx + "⚠️ " + m
                    }
                    streaming = false; thinking = false
                default: break
                }
            }
            streaming = false; thinking = false
        }
    }
}
