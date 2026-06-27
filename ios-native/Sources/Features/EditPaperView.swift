import SwiftUI

// Edit a paper's metadata, tags, notes, reading status and collection membership.
// Native mirror of the detail-panel editing in Library.tsx / Modals.tsx.
struct EditPaperView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paperId: String

    @State private var draft = Paper(id: "")
    @State private var newTag = ""
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $draft.title, axis: .vertical)
                }
                Section("Authors") {
                    TextField("Short (e.g. Vaswani et al.)", text: $draft.authors)
                    TextField("Full author list", text: $draft.authorsFull, axis: .vertical)
                }
                Section("Publication") {
                    TextField("Venue", text: $draft.venue)
                    Stepper(value: $draft.year, in: 0...2100) {
                        Text(draft.year > 0 ? "Year: \(String(draft.year))" : "Year: —")
                    }
                    TextField("DOI", text: $draft.doi).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("arXiv", text: $draft.arxiv).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section("Reading") {
                    Picker("Status", selection: $draft.statusBinding) {
                        Text("Unread").tag(ReadingStatus.unread)
                        Text("Reading").tag(ReadingStatus.reading)
                        Text("Done").tag(ReadingStatus.done)
                    }
                    Toggle("Favorite", isOn: $draft.fav)
                }
                Section("Tags") {
                    if !draft.tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(draft.tags, id: \.self) { t in
                                    HStack(spacing: 4) {
                                        Text(t).font(.caption)
                                        Button { draft.tags.removeAll { $0 == t } } label: {
                                            Image(systemName: "xmark.circle.fill").font(.caption2)
                                        }
                                    }
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(Color.accentColor.opacity(0.15), in: Capsule())
                                }
                            }
                        }
                    }
                    HStack {
                        TextField("Add tag", text: $newTag).onSubmit(addTag)
                        Button("Add", action: addTag).disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                Section("Notes") {
                    TextField("Notes", text: $draft.notes, axis: .vertical).lineLimit(4...12)
                }
                Section("Collections") {
                    ForEach(model.collections) { c in
                        Button {
                            model.toggleInCollection(draft.id, c.id)
                        } label: {
                            HStack {
                                Circle().fill(Color(hex: c.color)).frame(width: 9, height: 9)
                                Text(c.name).foregroundStyle(.primary)
                                Spacer()
                                if c.ids.contains(draft.id) {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                    if model.collections.isEmpty {
                        Text("No collections yet.").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
            .onAppear {
                if !loaded, let p = model.paper(paperId) { draft = p; loaded = true }
            }
        }
    }

    private func addTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !draft.tags.contains(t) else { newTag = ""; return }
        draft.tags.append(t); newTag = ""
    }

    private func save() {
        model.updatePaper(draft.id) { p in
            p.title = draft.title
            p.authors = draft.authors
            p.authorsFull = draft.authorsFull
            p.venue = draft.venue
            p.year = draft.year
            p.doi = draft.doi
            p.arxiv = draft.arxiv
            p.tags = draft.tags
            p.notes = draft.notes
            p.fav = draft.fav
            p.status = draft.status
            p.read = (draft.status == .done)
        }
        dismiss()
    }
}

private extension Paper {
    // A binding that reads/writes effectiveStatus on the draft.
    var statusBinding: ReadingStatus {
        get { status ?? (read ? .done : .unread) }
        set { status = newValue; read = (newValue == .done) }
    }
}
