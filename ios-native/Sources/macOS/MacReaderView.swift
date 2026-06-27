import SwiftUI
import PDFKit

// Right column: a metadata header + the native PDFKit reader. The PDF is resolved
// (cache → server object store → remote pdfUrl) via the shared PDFService.
struct MacReaderView: View {
    @Environment(AppModel.self) private var model
    let paper: Paper

    @State private var pdfURL: URL?
    @State private var loading = true

    // Live view of the paper so fav/read toggles reflect immediately.
    private var p: Paper { model.paper(paper.id) ?? paper }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .navigationTitle(p.title.isEmpty ? "Reader" : p.title)
        .task(id: paper.id) { await resolve() }
        .toolbar {
            ToolbarItemGroup {
                Button { model.toggleFav(p.id) } label: {
                    Image(systemName: p.fav ? "star.fill" : "star")
                }
                .help("Favorite")
                Button { model.toggleRead(p.id) } label: {
                    Image(systemName: p.read ? "checkmark.circle.fill" : "circle")
                }
                .help(p.read ? "Mark unread" : "Mark read")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(p.title.isEmpty ? "Untitled" : p.title)
                .font(.title3).fontWeight(.semibold)
                .fixedSize(horizontal: false, vertical: true)
            Text(p.authorsFull.isEmpty ? p.authors : p.authorsFull)
                .font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if p.year > 0 { metaChip(String(p.year)) }
                if !p.venue.isEmpty { metaChip(p.venue) }
                if !p.arxiv.isEmpty { metaChip("arXiv:\(p.arxiv)") }
            }
            if p.retracted != nil {
                Label("Retracted", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.red)
            }
            if !p.tags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(p.tags, id: \.self) { t in
                        Text(t).font(.caption2)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.quaternary, in: Capsule())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        if let url = pdfURL {
            MacPDFView(url: url)
        } else if loading {
            ProgressView("Loading PDF…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            missing
        }
    }

    private var missing: some View {
        VStack(spacing: 12) {
            ContentUnavailableView(
                "No PDF",
                systemImage: "doc.questionmark",
                description: Text(p.abstract.isEmpty ? "This item has no PDF on the server yet." : p.abstract)
            )
            HStack {
                if !p.arxiv.isEmpty, let u = URL(string: "https://arxiv.org/abs/\(p.arxiv)") {
                    Link("Open on arXiv", destination: u)
                }
                if !p.doi.isEmpty, let u = URL(string: "https://doi.org/\(p.doi)") {
                    Link("Open DOI", destination: u)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func metaChip(_ s: String) -> some View {
        Text(s).font(.caption)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 5))
    }

    private func resolve() async {
        loading = true
        pdfURL = nil
        if let cached = PDFService.cachedURL(for: paper.id) { pdfURL = cached; loading = false; return }
        if let url = await PDFService.downloadFromServer(
            id: paper.id, apiUrl: model.settings.apiUrl, token: model.settings.apiToken) {
            pdfURL = url; loading = false; return
        }
        if let remote = paper.pdfUrl, let u = await PDFService.download(remote, for: paper.id) {
            pdfURL = u; loading = false; return
        }
        loading = false
    }
}

// PDFKit's PDFView wrapped for SwiftUI on macOS.
struct MacPDFView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.document = PDFDocument(url: url)
        return v
    }

    func updateNSView(_ v: PDFView, context: Context) {
        if v.document?.documentURL != url {
            v.document = PDFDocument(url: url)
        }
    }
}
