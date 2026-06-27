import SwiftUI
import AppKit

// Format a citation in a chosen style (full CSL via the server, local fallback)
// and copy it. Mirrors CiteView. Presented as a sheet.
struct MacCiteView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let paperId: String

    @State private var style = "APA"
    @State private var rendered = ""
    @State private var loading = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Cite").font(.headline)

            Picker("Style", selection: $style) {
                ForEach(CiteService.styles, id: \.id) { Text($0.label).tag($0.id) }
            }
            .onChange(of: style) { _, _ in render() }

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.35))
                if loading {
                    ProgressView().padding()
                } else {
                    Text(rendered)
                        .font(style == "BibTeX" ? .system(.callout, design: .monospaced) : .callout)
                        .textSelection(.enabled)
                        .padding(12)
                }
            }
            .frame(minHeight: 120)

            HStack {
                Spacer()
                Button("Close") { dismiss() }
                Button(copied ? "Copied!" : "Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(rendered, forType: .string)
                    copied = true
                }
                .keyboardShortcut(.defaultAction)
                .disabled(rendered.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460)
        .onAppear { style = model.settings.defaultCite; render() }
    }

    private func render() {
        copied = false
        guard let p = model.paper(paperId) else { return }
        loading = true
        Task {
            let out = await CiteService.format(p, style: style,
                                               apiUrl: model.settings.apiUrl, token: model.settings.apiToken)
            rendered = out
            loading = false
        }
    }
}
