import SwiftUI

// Lightweight, dependency-free Markdown block renderer for the AI explainer and
// chat replies (headings, paragraphs, bullet/numbered lists, blockquotes, code
// fences). Inline bold/italic/code/links go through SwiftUI's own AttributedString
// markdown parsing. A macOS analogue of Features/MarkdownText.swift.
struct MacMarkdownText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                block.view
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    private enum Block {
        case heading(Int, String)
        case paragraph(String)
        case bullet(String)
        case numbered(String, String)
        case quote(String)
        case code(String)

        @ViewBuilder var view: some View {
            switch self {
            case let .heading(level, s):
                Text(inline(s))
                    .font(level <= 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                    .padding(.top, 4)
            case let .paragraph(s):
                Text(inline(s))
            case let .bullet(s):
                HStack(alignment: .top, spacing: 6) {
                    Text("•").foregroundStyle(.secondary)
                    Text(inline(s))
                }
            case let .numbered(n, s):
                HStack(alignment: .top, spacing: 6) {
                    Text(n + ".").foregroundStyle(.secondary).monospacedDigit()
                    Text(inline(s))
                }
            case let .quote(s):
                Text(inline(s))
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(.quaternary).frame(width: 3)
                    }
                    .foregroundStyle(.secondary)
            case let .code(s):
                Text(s)
                    .font(.system(.callout, design: .monospaced))
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
            }
        }

        // SwiftUI parses a useful subset of inline markdown (**bold**, *italic*,
        // `code`, [links](url)) when you build AttributedString with .markdown.
        private func inline(_ s: String) -> AttributedString {
            (try? AttributedString(markdown: s,
                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        }
    }

    private var blocks: [Block] {
        var out: [Block] = []
        var inCode = false
        var codeBuf: [String] = []
        for raw in text.components(separatedBy: "\n") {
            let line = raw
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if inCode { out.append(.code(codeBuf.joined(separator: "\n"))); codeBuf = [] }
                inCode.toggle()
                continue
            }
            if inCode { codeBuf.append(line); continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { continue }
            if t.hasPrefix("### ") { out.append(.heading(3, String(t.dropFirst(4)))) }
            else if t.hasPrefix("## ") { out.append(.heading(2, String(t.dropFirst(3)))) }
            else if t.hasPrefix("# ") { out.append(.heading(1, String(t.dropFirst(2)))) }
            else if t.hasPrefix("> ") { out.append(.quote(String(t.dropFirst(2)))) }
            else if t.hasPrefix("- ") || t.hasPrefix("* ") { out.append(.bullet(String(t.dropFirst(2)))) }
            else if let m = t.range(of: #"^\d+\.\s"#, options: .regularExpression) {
                let num = t[t.startIndex..<t.index(before: m.upperBound)].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ".", with: "")
                out.append(.numbered(num, String(t[m.upperBound...])))
            }
            else { out.append(.paragraph(t)) }
        }
        if !codeBuf.isEmpty { out.append(.code(codeBuf.joined(separator: "\n"))) }
        return out
    }
}
