import SwiftUI
import PDFKit
import UniformTypeIdentifiers

// The reader: an AI "explainer" tab and a PDFKit tab. The explainer streams a
// structured deep-dive (cached on the paper); the PDF tab supports highlights,
// page resume, import, and read-aloud. Mirrors ReaderView.swift for macOS.
struct MacReaderView: View {
    @Environment(AppModel.self) private var model
    let paper: Paper

    @StateObject private var pdf = MacPDFController()
    @StateObject private var tts = TtsService()

    @State private var tab = "explainer"
    @State private var pdfURL: URL?
    @State private var pdfLoading = true
    @State private var explaining = false
    @State private var streamed = ""
    @State private var readingPaper = false
    @State private var hlColor = "#FBE38E"
    @State private var importing = false
    @State private var showEdit = false
    @State private var showChat = false
    @State private var showCite = false

    private static let colors: [(String, String)] = [
        ("Yellow", "#FBE38E"), ("Green", "#B6E3A1"), ("Blue", "#A1C9E3"),
        ("Pink", "#E3A1C9"), ("Purple", "#C9A1E3"),
    ]

    private var p: Paper { model.paper(paper.id) ?? paper }
    private var aiConfigured: Bool {
        ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model).isConfigured
    }
    private var explainerBody: String? {
        if explaining, !streamed.isEmpty { return streamed }
        if let e = p.explainer, !e.isEmpty { return e }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Picker("", selection: $tab) {
                Text("Explainer").tag("explainer")
                Text("PDF").tag("pdf")
            }
            .pickerStyle(.segmented).labelsHidden().padding(.horizontal, 16).padding(.vertical, 8)
            Divider()
            if tab == "pdf" { pdfPane } else { explainerPane }
        }
        .navigationTitle(p.title.isEmpty ? "Reader" : p.title)
        .toolbar { toolbarItems }
        .task(id: paper.id) {
            await resolvePDF()
            if explainerBody == nil, aiConfigured { await generateExplainer() }
        }
        .sheet(isPresented: $showEdit) { MacEditPaperView(paperId: paper.id).environment(model) }
        .sheet(isPresented: $showChat) { MacChatView(paper: p).environment(model) }
        .sheet(isPresented: $showCite) { MacCiteView(paperId: paper.id).environment(model) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result { importPDF(url) }
        }
        .onDisappear { tts.stop() }
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(p.title.isEmpty ? "Untitled" : p.title).font(.title3).fontWeight(.semibold)
                .fixedSize(horizontal: false, vertical: true)
            Text(p.authorsFull.isEmpty ? p.authors : p.authorsFull).font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if p.year > 0 { chip(String(p.year)) }
                if !p.venue.isEmpty { chip(p.venue) }
                if !p.arxiv.isEmpty { chip("arXiv:\(p.arxiv)") }
            }
            if p.retracted != nil {
                Label("Retracted", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    // MARK: explainer

    private var explainerPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let body = explainerBody {
                    MacMarkdownText(text: body)
                } else if readingPaper || explaining {
                    Label("Reading the paper and writing your explainer…", systemImage: "sparkles")
                        .foregroundStyle(.secondary).padding(.vertical, 8)
                } else if !aiConfigured {
                    fallbackCard("Set an AI backend in Settings to generate a deep explainer. Showing the abstract for now.")
                } else {
                    fallbackCard("No explainer yet.")
                }
                if !p.notes.isEmpty || !p.hl.isEmpty { notesAndHighlights }
            }
            .padding(16)
        }
    }

    private func fallbackCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.caption).foregroundStyle(.secondary)
            if !p.abstract.isEmpty { Text(p.abstract) }
            if aiConfigured {
                Button("Generate explainer") { Task { await generateExplainer(force: true) } }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
    }

    private var notesAndHighlights: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            if !p.notes.isEmpty {
                Text("Notes").font(.headline)
                Text(p.notes)
            }
            if !p.hl.isEmpty {
                Text("Highlights").font(.headline)
                ForEach(Array(p.hl.enumerated()), id: \.offset) { _, h in
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2).fill(Color(hexString: h.color)).frame(width: 4)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.text)
                            if !h.note.isEmpty { Text(h.note).font(.caption).foregroundStyle(.secondary) }
                            Button("p.\(h.page)") { tab = "pdf"; pdf.goToPage(h.page) }
                                .buttonStyle(.plain).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
    }

    // MARK: pdf

    private var pdfPane: some View {
        VStack(spacing: 0) {
            if let _ = pdfURL {
                MacPDFKitView(controller: pdf)
                Divider()
                HStack(spacing: 10) {
                    Text("Highlight:").font(.caption).foregroundStyle(.secondary)
                    ForEach(Self.colors, id: \.1) { name, hex in
                        Button { addHighlight(hex) } label: {
                            Circle().fill(Color(hexString: hex)).frame(width: 16, height: 16)
                                .overlay(Circle().stroke(hlColor == hex ? Color.primary : .clear, lineWidth: 1.5))
                        }
                        .buttonStyle(.plain).help(name)
                    }
                    Spacer()
                    if pdf.pageCount > 0 {
                        Text("p.\(pdf.currentPage) / \(pdf.pageCount)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(8)
            } else if pdfLoading {
                ProgressView("Loading PDF…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    ContentUnavailableView("No PDF", systemImage: "doc.questionmark",
                        description: Text("Import a PDF or open the source link."))
                    HStack {
                        Button("Import PDF…") { importing = true }
                        if !p.arxiv.isEmpty, let u = URL(string: "https://arxiv.org/abs/\(p.arxiv)") { Link("arXiv", destination: u) }
                        if !p.doi.isEmpty, let u = URL(string: "https://doi.org/\(p.doi)") { Link("DOI", destination: u) }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItemGroup {
            Button { model.toggleFav(p.id) } label: { Image(systemName: p.fav ? "star.fill" : "star") }
                .help("Favorite")
            Button { readAloud() } label: {
                Image(systemName: tts.state == .playing ? "stop.circle" : "speaker.wave.2")
            }
            .help("Read aloud")
            if tab == "pdf" {
                Button { importing = true } label: { Image(systemName: "square.and.arrow.down") }.help("Import PDF")
            }
            Menu {
                Button { showChat = true } label: { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }
                Button { showCite = true } label: { Label("Cite", systemImage: "quote.opening") }
                Button { showEdit = true } label: { Label("Edit", systemImage: "pencil") }
                if aiConfigured {
                    Button { Task { await generateExplainer(force: true) } } label: { Label("Regenerate explainer", systemImage: "arrow.clockwise") }
                }
                Divider()
                Picker("Status", selection: Binding(get: { p.effectiveStatus }, set: { model.setStatus(p.id, $0) })) {
                    Text("Unread").tag(ReadingStatus.unread)
                    Text("Reading").tag(ReadingStatus.reading)
                    Text("Done").tag(ReadingStatus.done)
                }
                Menu("Add to collection") {
                    ForEach(model.collections) { c in
                        Button { model.toggleInCollection(p.id, c.id) } label: {
                            Label(c.name.isEmpty ? "Untitled" : c.name,
                                  systemImage: c.ids.contains(p.id) ? "checkmark" : "folder")
                        }
                    }
                }
                Button { model.setArchived(p.id, !(p.archived ?? false)) } label: {
                    Label(p.archived == true ? "Unarchive" : "Archive", systemImage: "archivebox")
                }
                Divider()
                Button(role: .destructive) { model.deletePaper(p.id) } label: { Label("Delete", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis.circle") }
        }
    }

    private func chip(_ s: String) -> some View {
        Text(s).font(.caption).padding(.horizontal, 7).padding(.vertical, 2)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 5))
    }

    // MARK: actions

    private func resolvePDF() async {
        pdfLoading = true
        var url = PDFService.cachedURL(for: paper.id)
        if url == nil {
            url = await PDFService.downloadFromServer(id: paper.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken)
        }
        if url == nil, let remote = p.pdfUrl { url = await PDFService.download(remote, for: paper.id) }
        pdfURL = url
        pdfLoading = false
        if let url {
            pdf.onPageChange = { page in
                model.updatePaper(paper.id) { $0.lastPage = page }
            }
            pdf.load(url: url, savedHighlights: p.hl, startPage: p.lastPage ?? 1)
            if pdf.pageCount > 0 { model.updatePaper(paper.id) { $0.pages = pdf.pageCount } }
        }
    }

    private func importPDF(_ src: URL) {
        guard let dst = PDFService.importFile(src, for: paper.id) else { return }
        model.updatePaper(paper.id) { $0.file = "\(paper.id).pdf" }
        pdfURL = dst
        pdf.load(url: dst, savedHighlights: p.hl, startPage: 1)
        Task { await PDFService.uploadToServer(dst, id: paper.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
    }

    private func addHighlight(_ hex: String) {
        hlColor = hex
        guard let (text, page) = pdf.highlightSelection(colorHex: hex) else { return }
        model.updatePaper(paper.id) { $0.hl.append(Highlight(text: text, color: hex, page: page, note: "")) }
    }

    private func readAloud() {
        if tts.state == .playing || tts.state == .loading { tts.stop(); return }
        let text = explainerBody ?? p.abstract
        guard !text.isEmpty else { return }
        let pct = Int((model.settings.ttsRate - 1) * 100)
        let rate = "\(pct >= 0 ? "+" : "")\(pct)%"
        Task { await tts.speak(text, apiUrl: model.settings.apiUrl, token: model.settings.apiToken,
                               voice: model.settings.ttsVoice, rate: rate) }
    }

    private func generateExplainer(force: Bool = false) async {
        if force { model.updatePaper(paper.id) { $0.explainer = nil } }
        guard (p.explainer ?? "").isEmpty, !explaining, aiConfigured else { return }
        explaining = true; readingPaper = true; streamed = ""
        let svc = ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model)

        var fulltext = p.fulltext ?? ""
        if fulltext.isEmpty {
            var url = pdfURL ?? PDFService.cachedURL(for: paper.id)
            if url == nil { url = await PDFService.downloadFromServer(id: paper.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
            if let u = url { fulltext = PDFService.extractText(u) ?? ""; if pdfURL == nil { pdfURL = u } }
        }
        var paperDict = p.payloadDict
        if !fulltext.isEmpty { paperDict["fulltext"] = String(fulltext.prefix(90_000)) }
        let payload: [String: Any] = ["mode": "chat", "paper": paperDict, "history": [], "question": Self.explainerPrompt]

        var acc = ""
        for await ev in svc.stream(payload) {
            switch ev {
            case .delta(let t): acc += t; streamed = acc; readingPaper = false
            case .thinkingStart, .thinking: readingPaper = true
            case .done:
                if !acc.isEmpty {
                    model.updatePaper(paper.id) { pp in
                        pp.explainer = acc
                        if !fulltext.isEmpty { pp.fulltext = String(fulltext.prefix(90_000)) }
                    }
                }
                explaining = false; readingPaper = false
            case .error: explaining = false; readingPaper = false
            default: break
            }
        }
        explaining = false; readingPaper = false
    }

    private static let explainerPrompt = """
    Write a deep, self-contained technical explainer of this paper for an expert who has NOT read it. Strip out all bloat, boilerplate, and filler — keep only the substantive signal. Be concrete and specific; prefer details from the paper over generic statements. Assume the reader knows the field and define only genuinely novel jargon. Do not invent anything unsupported by the text; if the paper doesn't cover something, say so.

    Use Markdown with these sections (drop one only if there is truly nothing to say):

    ## TL;DR
    2–3 sentences: what they did and why it matters.

    ## Problem
    The specific gap and why prior approaches fall short.

    ## Key idea
    The core insight that makes this work.

    ## How it works
    The method/architecture in enough detail to understand and critique it — key equations/algorithms described in words.

    ## Results
    Headline numbers, the baselines that matter, and what is actually demonstrated vs merely claimed.

    ## Why it matters
    Implications and what it unlocks.

    ## Limitations
    Honest weaknesses, failure modes, and open questions.

    ## Key terms
    Define only the novel or non-obvious terms this paper introduces or leans on.
    """
}
