import SwiftUI

// Spaced-repetition study: a shared card session driving both the full deck
// (Flashcards) and due-only (Daily Review). Mirrors StudyViews.swift.
struct MacCardStudyView: View {
    @Environment(AppModel.self) private var model
    let title: String
    let cards: [DueCard]

    @State private var idx = 0
    @State private var showAnswer = false

    var body: some View {
        VStack(spacing: 16) {
            if cards.isEmpty {
                ContentUnavailableView("All caught up", systemImage: "checkmark.seal",
                    description: Text("No cards to study right now."))
            } else if idx >= cards.count {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(.green)
                    Text("Session complete").font(.headline)
                    Button("Study again") { idx = 0; showAnswer = false }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let card = cards[idx]
                ProgressView(value: Double(idx), total: Double(cards.count))
                    .padding(.horizontal)
                Text("\(idx + 1) / \(cards.count)").font(.caption).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2).fill(Color(hexString: card.highlight.color)).frame(width: 4)
                        Text(card.highlight.text).font(.title3)
                    }
                    if showAnswer {
                        Divider()
                        if !card.highlight.note.isEmpty {
                            Text(card.highlight.note).foregroundStyle(.secondary)
                        }
                        Text(card.paperTitle).font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(20)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))

                Spacer()
                if showAnswer {
                    HStack(spacing: 10) {
                        gradeButton("Again", .again, .red)
                        gradeButton("Good", .good, .blue)
                        gradeButton("Easy", .easy, .green)
                    }
                } else {
                    Button("Show answer") { showAnswer = true }
                        .keyboardShortcut(.space, modifiers: [])
                        .controlSize(.large)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(title)
    }

    private func gradeButton(_ label: String, _ grade: Grade, _ tint: Color) -> some View {
        Button(label) {
            let card = cards[idx]
            model.gradeCard(card.paperId, card.hlIndex, grade)
            idx += 1; showAnswer = false
        }
        .tint(tint).controlSize(.large)
    }
}

struct MacFlashcardsView: View {
    @Environment(AppModel.self) private var model
    var body: some View { MacCardStudyView(title: "Flashcards", cards: model.allCards) }
}

struct MacReviewView: View {
    @Environment(AppModel.self) private var model
    var body: some View { MacCardStudyView(title: "Daily Review", cards: model.dueCards) }
}
