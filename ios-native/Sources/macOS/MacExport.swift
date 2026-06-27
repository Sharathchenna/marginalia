import AppKit

// Library export to BibTeX / RIS via a save panel. BibTeX reuses the shared
// Citation formatter; RIS is a minimal inline serializer. Mirrors the desktop
// exportLibrary.
enum MacExport {
    static func bibtex(_ papers: [Paper]) -> String {
        papers.filter { !$0.deleted && $0.itemKind == .paper }
            .map { Citation.format($0, style: "BibTeX") }
            .joined(separator: "\n\n") + "\n"
    }

    static func ris(_ papers: [Paper]) -> String {
        papers.filter { !$0.deleted }.map { p -> String in
            let ty = !p.arxiv.isEmpty ? "GEN" : !p.doi.isEmpty ? "JOUR" : "CONF"
            var lines = ["TY  - \(ty)", "TI  - \(p.title)"]
            for a in (p.authorsFull.isEmpty ? p.authors : p.authorsFull).split(separator: ",") {
                lines.append("AU  - \(a.trimmingCharacters(in: .whitespaces))")
            }
            if p.year > 0 { lines.append("PY  - \(p.year)") }
            if !p.venue.isEmpty { lines.append("T2  - \(p.venue)") }
            if !p.doi.isEmpty, p.doi != "—" { lines.append("DO  - \(p.doi)") }
            if !p.abstract.isEmpty { lines.append("AB  - \(p.abstract)") }
            for t in p.tags { lines.append("KW  - \(t)") }
            lines.append("ER  - ")
            return lines.joined(separator: "\n")
        }.joined(separator: "\n\n") + "\n"
    }

    @MainActor
    static func save(_ content: String, suggested: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggested
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? content.write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
