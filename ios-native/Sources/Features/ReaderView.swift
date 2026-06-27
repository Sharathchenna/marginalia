import SwiftUI
import UniformTypeIdentifiers

// The reader. The **Explainer** (a deep, AI-generated, bloat-free walkthrough,
// grounded in the paper's full text) is the primary view; the original PDF is one
// tap away. The explainer is generated lazily on first open and cached.
struct ReaderView: View {
    @Environment(AppModel.self) private var model
    let paperId: String

    @State private var showingEdit = false
    @State private var showingImporter = false
    @State private var showingChat = false
    @State private var showingCite = false
    @State private var tab = "explainer"
    @State private var pdfURL: URL?
    @State private var pdf = PDFController()
    @State private var hlColor = "#FBE38E"

    @State private var explaining = false
    @State private var streamed = ""
    @State private var explainError: String?
    @State private var explainTask: Task<Void, Never>?

    private static let highlightColors = ["#FBE38E", "#A7E8BD", "#A9D3FF", "#F7B6C2", "#D8B4FE"]
    private var paper: Paper? { model.paper(paperId) }
    private var aiConfigured: Bool {
        ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model).isConfigured
    }
    private var explainerBody: String? {
        if let e = paper?.explainer, !e.isEmpty { return e }
        return streamed.isEmpty ? nil : streamed
    }

    var body: some View {
        Group {
            if let p = paper {
                if tab == "pdf" { pdfPane(p) } else { explainerPane(p) }
            } else {
                ContentUnavailableView("Not found", systemImage: "doc")
            }
        }
        .navigationTitle(paper?.title ?? "Reader")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .sheet(isPresented: $showingEdit) { EditPaperView(paperId: paperId).environment(model) }
        .sheet(isPresented: $showingChat) { if let p = paper { ChatView(paper: p).environment(model) } }
        .sheet(isPresented: $showingCite) { CiteView(paperId: paperId).environment(model) }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result, let u = PDFService.importFile(url, for: paperId) {
                pdfURL = u; tab = "pdf"
                model.updatePaper(paperId) { $0.file = "\(paperId).pdf" }
                // Push to the data server so it's served from there on every device.
                Task { await PDFService.uploadToServer(u, id: paperId, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
            }
        }
        .task(id: paperId) {
            await resolvePDF()
            await ensureExplainer()
        }
    }

    // MARK: Explainer pane (primary)

    @ViewBuilder
    private func explainerPane(_ p: Paper) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(p)

                if let body = explainerBody {
                    MarkdownText(text: body)
                    if explaining {
                        Label("Writing…", systemImage: "sparkles").font(.caption).foregroundStyle(.secondary)
                    }
                } else if explaining {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Reading the paper and writing your explainer…")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if let e = explainError {
                    fallbackCard(p, message: e, retry: true)
                } else if !aiConfigured {
                    fallbackCard(p, message: "Set an AI backend in Settings to generate a deep explainer. Showing the abstract for now.", retry: false)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                }

                notesAndHighlights(p)
            }
            .padding()
        }
    }

    private func header(_ p: Paper) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(p.title).font(.title2.bold())
            Text(metaLine(p)).font(.subheadline).foregroundStyle(.secondary)
            if !p.tags.isEmpty { FlowTags(tags: p.tags) }
            if let r = p.retracted {
                Label("Retracted — \(r.reason)", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold)).foregroundStyle(.white)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red, in: RoundedRectangle(cornerRadius: 8))
            }
            Divider()
        }
    }

    private func fallbackCard(_ p: Paper, message: String, retry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary)
            if retry {
                Button { Task { await regenerate() } } label: { Label("Try again", systemImage: "arrow.clockwise") }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            if !p.abstract.isEmpty {
                Text("Abstract").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4)
                Text(p.abstract).font(.callout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding().background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func notesAndHighlights(_ p: Paper) -> some View {
        if !p.notes.isEmpty || !p.hl.isEmpty {
            Divider().padding(.vertical, 4)
            if !p.notes.isEmpty {
                Text("YOUR NOTES").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(p.notes).font(.callout)
            }
            if !p.hl.isEmpty {
                Text("HIGHLIGHTS (\(p.hl.count))").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4)
                ForEach(Array(p.hl.enumerated()), id: \.offset) { _, h in
                    Button { openHighlight(h) } label: {
                        HStack(alignment: .top, spacing: 8) {
                            RoundedRectangle(cornerRadius: 2).fill(Color(hex: h.color)).frame(width: 4)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.text).font(.footnote).foregroundStyle(.primary)
                                if !h.note.isEmpty { Text(h.note).font(.caption).foregroundStyle(.secondary) }
                                Text("p.\(h.page)").font(.caption2).foregroundStyle(.tertiary)
                            }
                            Spacer()
                        }
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: PDF pane

    @ViewBuilder
    private func pdfPane(_ p: Paper) -> some View {
        if let url = pdfURL {
            VStack(spacing: 0) {
                PDFKitView(url: url, controller: pdf, savedHighlights: p.hl,
                           initialPage: p.lastPage ?? 1, onPageChange: savePage)
                if pdf.pageCount > 0 {
                    HStack(spacing: 8) {
                        ProgressView(value: Double(min(p.lastPage ?? 1, pdf.pageCount)), total: Double(pdf.pageCount))
                        Text("\(p.lastPage ?? 1)/\(pdf.pageCount)").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                    }
                    .padding(.horizontal).padding(.vertical, 6).background(.bar)
                }
            }
        } else {
            ContentUnavailableView {
                Label("No PDF attached", systemImage: "doc.text")
            } description: {
                Text("Import a PDF, or attach the sample to read the original.")
            } actions: {
                Button("Import PDF…") { showingImporter = true }.buttonStyle(.borderedProminent)
                Button("Attach sample PDF") { if let u = PDFService.attachSample(to: p.id) { pdfURL = u } }
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $tab) {
                Text("Explainer").tag("explainer")
                Text("PDF").tag("pdf")
            }.pickerStyle(.segmented).frame(width: 180)
        }
        if tab == "pdf", pdfURL != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(Self.highlightColors, id: \.self) { c in
                        Button { hlColor = c; addHighlight() } label: {
                            Label("Highlight", systemImage: hlColor == c ? "checkmark" : "").foregroundStyle(Color(hex: c))
                        }
                    }
                } label: { Image(systemName: "highlighter") } primaryAction: { addHighlight() }
            }
        }
        if let p = paper {
            ToolbarItem(placement: .topBarTrailing) {
                Button { model.toggleFav(p.id) } label: {
                    Image(systemName: p.fav ? "star.fill" : "star").foregroundStyle(p.fav ? .yellow : .primary)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showingChat = true } label: { Label("Chat about this", systemImage: "bubble.left.and.bubble.right") }
                    Button { Task { await regenerate() } } label: { Label("Regenerate explainer", systemImage: "arrow.clockwise") }
                    Button { showingCite = true } label: { Label("Cite", systemImage: "quote.opening") }
                    Button { showingEdit = true } label: { Label("Edit", systemImage: "pencil") }
                    Picker("Status", selection: Binding(get: { p.effectiveStatus }, set: { model.setStatus(p.id, $0) })) {
                        Text("Unread").tag(ReadingStatus.unread)
                        Text("Reading").tag(ReadingStatus.reading)
                        Text("Done").tag(ReadingStatus.done)
                    }
                    Menu("Add to collection") {
                        ForEach(model.collections) { c in
                            Button { model.toggleInCollection(p.id, c.id) } label: {
                                Label(c.name, systemImage: c.ids.contains(p.id) ? "checkmark" : "")
                            }
                        }
                    }
                    if p.isArticle {
                        Button { model.setArchived(p.id, !(p.archived ?? false)) } label: {
                            Label(p.archived == true ? "Unarchive" : "Archive", systemImage: "archivebox")
                        }
                    }
                    Divider()
                    Button(role: .destructive) { model.deletePaper(p.id) } label: { Label("Delete", systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
    }

    // MARK: Explainer generation

    private func ensureExplainer() async {
        guard let p = paper, (p.explainer ?? "").isEmpty, !explaining else { return }
        let svc = ChatService(baseURL: model.settings.apiUrl, token: model.settings.apiToken, model: model.settings.model)
        guard svc.isConfigured else { return }
        explaining = true; streamed = ""; explainError = nil

        // Ground in the full paper text when we can get it.
        var fulltext = p.fulltext ?? ""
        if fulltext.isEmpty {
            var url = pdfURL ?? PDFService.cachedURL(for: p.id)
            if url == nil { url = await PDFService.downloadFromServer(id: p.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) }
            if url == nil, let s = p.pdfUrl, !s.isEmpty { url = await PDFService.download(s, for: p.id) }
            if let u = url { fulltext = PDFService.extractText(u) ?? ""; if pdfURL == nil { pdfURL = u } }
        }

        var paperDict = p.payloadDict
        if !fulltext.isEmpty { paperDict["fulltext"] = String(fulltext.prefix(90_000)) }
        let payload: [String: Any] = ["mode": "chat", "paper": paperDict, "history": [], "question": Self.explainerPrompt]

        var acc = ""
        for await ev in svc.stream(payload) {
            switch ev {
            case .delta(let t): acc += t; streamed = acc
            case .done:
                if !acc.isEmpty {
                    model.updatePaper(paperId) { p in
                        p.explainer = acc
                        if !fulltext.isEmpty { p.fulltext = String(fulltext.prefix(90_000)) }
                        if p.status == nil || p.status == .unread { p.status = .reading }
                    }
                }
                explaining = false
            case .error(let m):
                explainError = m; explaining = false
            default: break
            }
        }
        explaining = false
    }

    private func regenerate() async {
        model.updatePaper(paperId) { $0.explainer = nil }
        streamed = ""; explainError = nil
        await ensureExplainer()
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

    // MARK: PDF actions

    private func resolvePDF() async {
        guard let p = paper, pdfURL == nil else { return }
        if let u = PDFService.cachedURL(for: p.id) { pdfURL = u; return }
        // Served from the self-hosted data server (uploaded on import elsewhere).
        if let u = await PDFService.downloadFromServer(id: p.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) {
            pdfURL = u; return
        }
        if ProcessInfo.processInfo.environment["MARG_ATTACH"] == "1", let u = PDFService.attachSample(to: p.id) { pdfURL = u }
    }

    private func addHighlight() {
        guard let (text, page) = pdf.highlightSelection(color: hlColor) else { return }
        model.updatePaper(paperId) { $0.hl.append(Highlight(text: text, color: hlColor, page: page)) }
    }

    private func savePage(_ page: Int) {
        model.updatePaper(paperId) { p in
            p.lastPage = page
            if pdf.pageCount > 0 { p.pages = pdf.pageCount }
        }
    }

    private func openHighlight(_ h: Highlight) {
        tab = "pdf"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { pdf.goToPage(h.page) }
    }

    private func metaLine(_ p: Paper) -> String {
        var parts: [String] = []
        if !p.authorsFull.isEmpty { parts.append(p.authorsFull) } else if !p.authors.isEmpty { parts.append(p.authors) }
        if p.year > 0 { parts.append(String(p.year)) }
        if !p.venue.isEmpty { parts.append(p.venue) }
        return parts.joined(separator: " · ")
    }
}

struct FlowTags: View {
    let tags: [String]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { t in
                    Text(t).font(.caption2)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
            }
        }
    }
}
