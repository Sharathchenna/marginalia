import Foundation

// Citation formatting for the common deterministic styles — native port of the
// APA/MLA/Chicago/BibTeX paths in citation.ts. Full CSL styles remain a
// server-side (/v1/cite) follow-up.
enum Citation {
    static let styles = ["APA", "MLA", "Chicago", "BibTeX"]

    static func format(_ p: Paper, style: String) -> String {
        let authors = p.authorsFull.isEmpty ? p.authors : p.authorsFull
        let year = p.year > 0 ? String(p.year) : "n.d."
        let title = p.title
        let venue = p.venue
        let doiURL = p.doi.isEmpty ? "" : "https://doi.org/\(p.doi)"

        switch style {
        case "MLA":
            if p.itemKind == .article, let u = p.url, !u.isEmpty {
                return "\(authors). \"\(title).\" \(venue.isEmpty ? "" : venue + ", ")\(year), \(u)."
            }
            return "\(authors). \"\(title).\" \(venue.isEmpty ? "" : venue + ", ")\(year)."
        case "Chicago":
            return "\(authors). \"\(title).\" \(venue)\(venue.isEmpty ? "" : " ")(\(year))."
        case "BibTeX":
            return """
            @article{\(bibKey(p)),
              title   = {\(title)},
              author  = {\(bibAuthors(authors))},
              year    = {\(year)},
              journal = {\(venue)}\(p.doi.isEmpty ? "" : ",\n  doi     = {\(p.doi)}")
            }
            """
        default: // APA
            var s = "\(authors) (\(year)). \(title). \(venue)."
            if !doiURL.isEmpty { s += " \(doiURL)" }
            return s
        }
    }

    private static func bibAuthors(_ a: String) -> String {
        a.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " and ")
    }
    private static func bibKey(_ p: Paper) -> String {
        let firstWord = (p.authors.split(separator: " ").first.map(String.init) ?? "ref")
        let key = (firstWord + (p.year > 0 ? String(p.year) : "")).filter { $0.isLetter || $0.isNumber }
        return key.isEmpty ? "ref" : key
    }
}
