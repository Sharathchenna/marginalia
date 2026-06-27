import SwiftUI

// Edit a paper's metadata, tags, notes, status, favorite, and collection
// membership. Mirrors EditPaperView. Presented as a sheet.
struct MacEditPaperView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paperId: String

    @State private var draft: Paper?
    @State private var newTag = ""

    var body: some View {
        VStack(spacing: 0) {
            if let p = draft {
                Form {
                    Section("Metadata") {
                        TextField("Title", text: bind(\.title))
                        TextField("Authors (short)", text: bind(\.authors))
                        TextField("Authors (full)", text: bind(\.authorsFull))
                        TextField("Venue", text: bind(\.venue))
                        TextField("Year", value: bind(\.year), format: .number.grouping(.never))
                        TextField("DOI", text: bind(\.doi))
                        TextField("arXiv", text: bind(\.arxiv))
                    }
                    Section("Status") {
                        Picker("Reading status", selection: bind(\.status, default: p.effectiveStatus)) {
                            Text("Unread").tag(Optional(ReadingStatus.unread))
                            Text("Reading").tag(Optional(ReadingStatus.reading))
                            Text("Done").tag(Optional(ReadingStatus.done))
                        }
                        Toggle("Favorite", isOn: bind(\.fav))
                    }
                    Section("Tags") {
                        FlowTags(tags: p.tags) { removeTag($0) }
                        HStack {
                            TextField("Add tag", text: $newTag).onSubmit { addTag() }
                            Button("Add") { addTag() }.disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    Section("Notes") {
                        TextEditor(text: bind(\.notes)).frame(minHeight: 80)
                    }
                    Section("Collections") {
                        ForEach(model.collections) { c in
                            Toggle(c.name.isEmpty ? "Untitled" : c.name, isOn: Binding(
                                get: { c.ids.contains(paperId) },
                                set: { _ in model.toggleInCollection(paperId, c.id) }
                            ))
                        }
                    }
                }
                .formStyle(.grouped)
            } else {
                ContentUnavailableView("Not found", systemImage: "questionmark")
            }
            Divider()
            HStack {
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(12)
        }
        .frame(width: 520, height: 560)
        .onAppear { draft = model.paper(paperId) }
    }

    // A binding that writes straight through to the model (persists + syncs).
    private func bind<V>(_ kp: WritableKeyPath<Paper, V>) -> Binding<V> {
        Binding(
            get: { draft?[keyPath: kp] ?? model.paper(paperId)?[keyPath: kp] ?? (draft![keyPath: kp]) },
            set: { v in
                draft?[keyPath: kp] = v
                model.updatePaper(paperId) { $0[keyPath: kp] = v }
            }
        )
    }
    private func bind(_ kp: WritableKeyPath<Paper, ReadingStatus?>, default def: ReadingStatus) -> Binding<ReadingStatus?> {
        Binding(
            get: { draft?[keyPath: kp] ?? def },
            set: { v in
                draft?[keyPath: kp] = v
                if let s = v { model.setStatus(paperId, s) }
            }
        )
    }

    private func addTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        model.updatePaper(paperId) { if !$0.tags.contains(t) { $0.tags.append(t) } }
        draft = model.paper(paperId); newTag = ""
    }
    private func removeTag(_ t: String) {
        model.updatePaper(paperId) { $0.tags.removeAll { $0 == t } }
        draft = model.paper(paperId)
    }
}

// Simple wrapping tag chips with a remove action.
struct FlowTags: View {
    let tags: [String]
    let onRemove: (String) -> Void
    var body: some View {
        if tags.isEmpty {
            Text("No tags").font(.caption).foregroundStyle(.secondary)
        } else {
            // A LazyVGrid adaptive layout approximates wrapping flow on macOS.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
                ForEach(tags, id: \.self) { t in
                    HStack(spacing: 4) {
                        Text(t).font(.caption)
                        Button { onRemove(t) } label: { Image(systemName: "xmark.circle.fill").font(.caption2) }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
                }
            }
        }
    }
}
