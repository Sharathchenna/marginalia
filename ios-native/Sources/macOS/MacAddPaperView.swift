import SwiftUI

// Add a paper by DOI / arXiv id / URL (metadata lookup) or clip a web page.
// Mirrors AddPaperView. Presented as a sheet.
struct MacAddPaperView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var mode = 0 // 0 = paper (DOI/arXiv/URL), 1 = web clip
    @State private var preview: Paper?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add to library").font(.headline)

            Picker("", selection: $mode) {
                Text("Paper (DOI / arXiv / URL)").tag(0)
                Text("Web page").tag(1)
            }
            .pickerStyle(.segmented).labelsHidden()

            HStack {
                TextField(mode == 0 ? "10.1038/… or arXiv:1706.03762 or URL" : "https://…", text: $text)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { resolve() }
                Button(loading ? "…" : "Fetch") { resolve() }
                    .disabled(loading || text.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if let error { Text(error).font(.caption).foregroundStyle(.red) }

            if let p = preview {
                VStack(alignment: .leading, spacing: 4) {
                    Text(p.title).fontWeight(.semibold)
                    Text(p.authorsFull.isEmpty ? p.authors : p.authorsFull).font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        if p.year > 0 { Text(String(p.year)).font(.caption) }
                        if !p.venue.isEmpty { Text(p.venue).font(.caption).foregroundStyle(.secondary) }
                    }
                    if !p.abstract.isEmpty {
                        Text(p.abstract).font(.caption).foregroundStyle(.secondary).lineLimit(4)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Add") {
                    if let p = preview { model.addPaper(p); model.selectedId = p.id; dismiss() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(preview == nil)
            }
        }
        .padding(20)
        .frame(width: 480)
    }

    private func resolve() {
        let q = text.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        loading = true; error = nil; preview = nil
        Task {
            do {
                preview = mode == 0 ? try await LookupService.lookup(q) : try await LookupService.clipWebpage(q)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            loading = false
        }
    }
}
