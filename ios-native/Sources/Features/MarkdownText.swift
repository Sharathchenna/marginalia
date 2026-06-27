import SwiftUI

// A lightweight Markdown block renderer (zero-dependency). Handles headings,
// paragraphs, bullet/numbered lists, blockquotes, and code blocks; inline
// **bold**/*italic*/`code`/links come free via Text(LocalizedStringKey:).
// Good enough for AI explainers without pulling in a Markdown package.
struct MarkdownText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(parse().enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
    }

    private enum Block {
        case heading(Int, String)
        case paragraph(String)
        case bullets([String])
        case numbered([String])
        case quote(String)
        case code(String)
    }

    @ViewBuilder
    private func view(for block: Block) -> some View {
        switch block {
        case .heading(let level, let s):
            Text(inline(s))
                .font(level <= 1 ? .title2.bold() : (level == 2 ? .title3.bold() : .headline))
                .padding(.top, level <= 2 ? 6 : 2)
        case .paragraph(let s):
            Text(inline(s)).font(.callout).fixedSize(horizontal: false, vertical: true)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•").font(.callout).foregroundStyle(.secondary)
                        Text(inline(it)).font(.callout).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                    HStack(alignment: .top, spacing: 8) {
                        Text("\(i + 1).").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                        Text(inline(it)).font(.callout).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .quote(let s):
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 2).fill(Color.secondary.opacity(0.4)).frame(width: 3)
                Text(inline(s)).font(.callout).italic().foregroundStyle(.secondary)
            }
        case .code(let s):
            Text(s)
                .font(.system(.footnote, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func inline(_ s: String) -> LocalizedStringKey { LocalizedStringKey(s) }

    private func parse() -> [Block] {
        var blocks: [Block] = []
        let lines = text.components(separatedBy: "\n")
        var i = 0
        var para: [String] = []
        var inCode = false
        var code: [String] = []

        func flushPara() {
            if !para.isEmpty { blocks.append(.paragraph(para.joined(separator: " "))); para = [] }
        }

        while i < lines.count {
            let raw = lines[i]
            let line = raw.trimmingCharacters(in: .whitespaces)

            if line.hasPrefix("```") {
                if inCode { blocks.append(.code(code.joined(separator: "\n"))); code = []; inCode = false }
                else { flushPara(); inCode = true }
                i += 1; continue
            }
            if inCode { code.append(raw); i += 1; continue }

            if line.isEmpty { flushPara(); i += 1; continue }
            if line.hasPrefix("### ") { flushPara(); blocks.append(.heading(3, String(line.dropFirst(4)))); i += 1; continue }
            if line.hasPrefix("## ") { flushPara(); blocks.append(.heading(2, String(line.dropFirst(3)))); i += 1; continue }
            if line.hasPrefix("# ") { flushPara(); blocks.append(.heading(1, String(line.dropFirst(2)))); i += 1; continue }
            if line.hasPrefix("> ") { flushPara(); blocks.append(.quote(String(line.dropFirst(2)))); i += 1; continue }

            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flushPara()
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix("- ") || t.hasPrefix("* ") { items.append(String(t.dropFirst(2))); i += 1 } else { break }
                }
                blocks.append(.bullets(items)); continue
            }
            if line.range(of: #"^\d+\.\s"#, options: .regularExpression) != nil {
                flushPara()
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if let r = t.range(of: #"^\d+\.\s"#, options: .regularExpression) { items.append(String(t[r.upperBound...])); i += 1 } else { break }
                }
                blocks.append(.numbered(items)); continue
            }

            para.append(line); i += 1
        }
        flushPara()
        if inCode, !code.isEmpty { blocks.append(.code(code.joined(separator: "\n"))) }
        return blocks
    }
}
