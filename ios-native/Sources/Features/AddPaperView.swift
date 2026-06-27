import SwiftUI

// Add by identifier — paste a DOI / arXiv id / URL (or a web page to clip),
// fetch metadata, preview, and save. Native mirror of AddByIdModal in Modals.tsx.
struct AddPaperView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var mode = "paper"   // paper | web
    @State private var text = ""
    @State private var loading = false
    @State private var error: String?
    @State private var preview: Paper?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kind", selection: $mode) {
                    Text("DOI / arXiv").tag("paper")
                    Text("Web page").tag("web")
                }
                .pickerStyle(.segmented)
                .onChange(of: mode) { _, _ in preview = nil; error = nil }

                Section {
                    TextField(mode == "web" ? "https://…" : "DOI, arXiv id, or URL", text: $text, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button {
                        Task { await lookup() }
                    } label: {
                        HStack {
                            if loading { ProgressView().controlSize(.small) }
                            Text(loading ? "Looking up…" : "Look up")
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || loading)
                }

                if let e = error {
                    Section { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.callout) }
                }

                if let p = preview {
                    Section("Preview") {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(p.title).font(.headline)
                            if !p.authorsFull.isEmpty {
                                Text(p.authorsFull).font(.caption).foregroundStyle(.secondary)
                            }
                            let line = [p.year > 0 ? String(p.year) : "", p.venue].filter { !$0.isEmpty }.joined(separator: " · ")
                            if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                            if !p.abstract.isEmpty {
                                Text(p.abstract).font(.caption).foregroundStyle(.secondary).lineLimit(5)
                            }
                        }
                        Button("Add to library") {
                            model.addPaper(p)
                            dismiss()
                        }.buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func lookup() async {
        error = nil; preview = nil; loading = true
        defer { loading = false }
        do {
            preview = mode == "web"
                ? try await LookupService.clipWebpage(text)
                : try await LookupService.lookup(text)
        } catch let err {
            error = (err as? LocalizedError)?.errorDescription ?? err.localizedDescription
        }
    }
}
