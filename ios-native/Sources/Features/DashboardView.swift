import SwiftUI

// Home — native mirror of Dashboard.tsx: at-a-glance stats, continue-reading,
// and recently added.
struct DashboardView: View {
    @Environment(AppModel.self) private var model

    private var reading: [Paper] { model.papers.filter { $0.effectiveStatus == .reading } }
    private var recent: [Paper] { model.papers.sorted { $0.addedTs > $1.addedTs }.prefix(6).map { $0 } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    stat("Papers", model.counts.all, "books.vertical", .blue)
                    stat("Unread", model.counts.unread, "circle", .orange)
                    stat("Reading", reading.count, "book", .purple)
                    stat("Due cards", model.dueCards.count, "rectangle.on.rectangle", .green)
                }

                if !reading.isEmpty {
                    section("Continue reading") {
                        ForEach(reading.prefix(5)) { p in NavigationLink(value: p) { miniRow(p) } .buttonStyle(.plain) }
                    }
                }

                section("Recently added") {
                    ForEach(recent) { p in NavigationLink(value: p) { miniRow(p) } .buttonStyle(.plain) }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Home")
    }

    private func stat(_ title: String, _ value: Int, _ icon: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Image(systemName: icon).foregroundStyle(color); Spacer() }
            Text("\(value)").font(.system(size: 30, weight: .bold, design: .rounded))
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            VStack(spacing: 0) { content() }
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func miniRow(_ p: Paper) -> some View {
        HStack(spacing: 10) {
            if !p.read { Circle().fill(Color.accentColor).frame(width: 7, height: 7) }
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text([p.authors, p.year > 0 ? String(p.year) : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }
}
