import Foundation

// Spaced-repetition over per-highlight flashcards — native port of review.ts.
// Cards live on Paper.cards keyed by the highlight's index (as a String).

struct DueCard: Identifiable, Hashable {
    let id: String          // "<paperId>#<index>"
    let paperId: String
    let paperTitle: String
    let hlIndex: Int
    let highlight: Highlight
}

enum Grade { case again, good, easy }

enum SRS {
    static let day: Double = 86_400_000

    static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// All flashcards (every highlight) with their current card state.
    static func allCards(_ papers: [Paper]) -> [DueCard] {
        papers.flatMap { p in
            p.hl.enumerated().map { i, h in
                DueCard(id: "\(p.id)#\(i)", paperId: p.id, paperTitle: p.title, hlIndex: i, highlight: h)
            }
        }
    }

    /// Cards due for review at time `t` (new cards — no state — are always due).
    static func dueCards(_ papers: [Paper], at t: Double = SRS.now()) -> [DueCard] {
        allCards(papers).filter { card in
            let due = paper(papers, card.paperId)?.cards?[String(card.hlIndex)]?.due ?? 0
            return due <= t
        }
    }

    static func dueCount(_ papers: [Paper], at t: Double = SRS.now()) -> Int { dueCards(papers, at: t).count }

    /// Apply a grade (SM-2-ish) and return the updated card.
    static func grade(_ existing: Card?, _ grade: Grade, at t: Double = SRS.now()) -> Card {
        var c = existing ?? Card(due: 0, ease: 2.5, reps: 0)
        switch grade {
        case .again:
            c.ease = max(1.3, c.ease - 0.2); c.reps = 0; c.due = t + day
        case .good:
            c.reps += 1
            let interval = c.reps == 1 ? 1.0 : (c.reps == 2 ? 6.0 : Double(c.reps) * c.ease)
            c.due = t + interval * day
        case .easy:
            c.ease += 0.15; c.reps += 1
            let interval = max(4.0, Double(c.reps) * c.ease * 1.3)
            c.due = t + interval * day
        }
        return c
    }

    private static func paper(_ papers: [Paper], _ id: String) -> Paper? { papers.first { $0.id == id } }
}
