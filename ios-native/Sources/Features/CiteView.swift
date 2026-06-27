import SwiftUI
import UIKit

// Format and copy a citation in a chosen style — native mirror of CiteModal.
struct CiteView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paperId: String
    @State private var style = "APA"
    @State private var copied = false

    private var text: String {
        guard let p = model.paper(paperId) else { return "" }
        return Citation.format(p, style: style)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Style", selection: $style) {
                    ForEach(Citation.styles, id: \.self) { Text($0).tag($0) }
                }.pickerStyle(.segmented)

                Section {
                    Text(text)
                        .font(style == "BibTeX" ? .system(.footnote, design: .monospaced) : .callout)
                        .textSelection(.enabled)
                }

                Button {
                    UIPasteboard.general.string = text
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy citation", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
            }
            .onChange(of: style) { _, _ in copied = false }
            .navigationTitle("Cite")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { style = model.settings.defaultCite }
        }
    }
}
