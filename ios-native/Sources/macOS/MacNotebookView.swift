import SwiftUI

// All notes + highlights across the library, grouped by paper (read-only; editing
// happens in the reader). Mirrors NotebookView.
struct MacNotebookView: View {
    @Environment(AppModel.self) private var model

    private var withContent: [Paper] {
        model.papers.filter { !$0.notes.isEmpty || !$0.hl.isEmpty }
            .sorted { $0.addedTs > $1.addedTs }
    }

    var body: some View {
        Group {
            if withContent.isEmpty {
                ContentUnavailableView("No notes yet", systemImage: "note.text",
                    description: Text("Notes and highlights you make in the reader show up here."))
            } else {
                List {
                    ForEach(withContent) { p in
                        Section {
                            if !p.notes.isEmpty {
                                Text(p.notes).font(.callout)
                            }
                            ForEach(Array(p.hl.enumerated()), id: \.offset) { _, h in
                                HStack(alignment: .top, spacing: 8) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color(hexString: h.color))
                                        .frame(width: 4)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(h.text)
                                        if !h.note.isEmpty {
                                            Text(h.note).font(.caption).foregroundStyle(.secondary)
                                        }
                                        Text("p.\(h.page)").font(.caption2).foregroundStyle(.tertiary)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        } header: {
                            Button(p.title.isEmpty ? "Untitled" : p.title) { model.selectedId = p.id }
                                .buttonStyle(.plain).font(.headline)
                        }
                    }
                }
            }
        }
        .navigationTitle("Notebook")
        .toolbar { syncToolbar(model) }
    }
}

// Hex "#RRGGBB" → Color. Named distinctly to avoid clashing with the iOS target's
// Color(hex:) helper in SidebarView.swift.
extension Color {
    init(hexString: String) {
        let s = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let r, g, b: Double
        if s.count == 6 {
            r = Double((v & 0xFF0000) >> 16) / 255
            g = Double((v & 0x00FF00) >> 8) / 255
            b = Double(v & 0x0000FF) / 255
        } else { r = 0.5; g = 0.5; b = 0.5 }
        self = Color(red: r, green: g, blue: b)
    }
}
