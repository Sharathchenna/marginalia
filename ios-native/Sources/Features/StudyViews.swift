import SwiftUI

// Shared flashcard study session — used by Flashcards (whole deck) and Daily
// Review (due cards only). Mirrors Flashcards.tsx / Review.tsx.
struct CardStudyView: View {
    @Environment(AppModel.self) private var model
    let title: String
    let emptyText: String
    @State private var deck: [DueCard]
    @State private var index = 0
    @State private var showBack = false

    init(title: String, emptyText: String, cards: [DueCard]) {
        self.title = title
        self.emptyText = emptyText
        _deck = State(initialValue: cards)
    }

    var body: some View {
        Group {
            if deck.isEmpty {
                ContentUnavailableView("Nothing to study", systemImage: "checkmark.circle", description: Text(emptyText))
            } else if index >= deck.count {
                ContentUnavailableView {
                    Label("Session complete", systemImage: "checkmark.seal.fill")
                } description: {
                    Text("Reviewed \(deck.count) card\(deck.count == 1 ? "" : "s").")
                } actions: {
                    Button("Study again") { index = 0; showBack = false }
                }
            } else {
                card(deck[index])
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func card(_ c: DueCard) -> some View {
        VStack(spacing: 16) {
            ProgressView(value: Double(index), total: Double(deck.count)).padding(.horizontal)
            Text("\(index + 1) / \(deck.count)").font(.caption).foregroundStyle(.secondary)
            Spacer()
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 3).fill(Color(hex: c.highlight.color)).frame(width: 5)
                    Text(c.highlight.text).font(.title3.weight(.medium))
                }
                if showBack {
                    Divider()
                    Text(c.highlight.note.isEmpty ? "No note on this highlight." : c.highlight.note)
                        .font(.callout).foregroundStyle(c.highlight.note.isEmpty ? .secondary : .primary)
                    Text(c.paperTitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            Spacer()
            if showBack {
                HStack(spacing: 10) {
                    gradeButton("Again", .again, .red)
                    gradeButton("Good", .good, .blue)
                    gradeButton("Easy", .easy, .green)
                }
            } else {
                Button { showBack = true } label: { Text("Show answer").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            }
        }
        .padding()
    }

    private func gradeButton(_ label: String, _ g: Grade, _ color: Color) -> some View {
        Button {
            let c = deck[index]
            model.gradeCard(c.paperId, c.hlIndex, g)
            showBack = false
            index += 1
        } label: {
            Text(label).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered).controlSize(.large).tint(color)
    }
}

struct FlashcardsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        CardStudyView(title: "Flashcards", emptyText: "Highlight passages in the reader to create flashcards.", cards: model.allCards)
    }
}

struct ReviewView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        CardStudyView(title: "Daily Review", emptyText: "No cards are due. Check back later.", cards: model.dueCards)
    }
}
