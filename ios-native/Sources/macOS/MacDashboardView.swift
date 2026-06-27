import SwiftUI

// Home screen: at-a-glance stats + "continue reading" + "recently added".
struct MacDashboardView: View {
    @Environment(AppModel.self) private var model

    private var reading: [Paper] { model.papers.filter { $0.effectiveStatus == .reading }.prefix(8).map { $0 } }
    private var recent: [Paper] { model.papers.filter { $0.itemKind == .paper }.sorted { $0.addedTs > $1.addedTs }.prefix(8).map { $0 } }
    private var dueCount: Int { SRS.dueCount(model.papers) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                    stat("Papers", model.counts.all, "tray.full", .blue)
                    stat("Unread", model.counts.unread, "circle", .orange)
                    stat("Reading", reading.count, "book", .green)
                    stat("Due cards", dueCount, "rectangle.stack", .purple)
                }

                if !reading.isEmpty {
                    section("Continue reading", reading)
                }
                section("Recently added", recent)
            }
            .padding(20)
        }
        .navigationTitle("Home")
        .toolbar { syncToolbar(model) }
    }

    private func stat(_ title: String, _ value: Int, _ icon: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).foregroundStyle(tint)
            Text("\(value)").font(.title.bold())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func section(_ title: String, _ papers: [Paper]) -> some View {
        if !papers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline)
                ForEach(papers) { p in
                    Button { model.selectedId = p.id } label: { miniRow(p) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func miniRow(_ p: Paper) -> some View {
        HStack(spacing: 10) {
            Image(systemName: p.itemKind == .article ? "doc.text" : "doc.richtext")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.title.isEmpty ? "Untitled" : p.title).lineLimit(1)
                Text(p.authors).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if p.year > 0 { Text(String(p.year)).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 6).padding(.horizontal, 8)
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 7))
        .contentShape(Rectangle())
    }
}

// Shared sync toolbar item used across the screens.
@ToolbarContentBuilder
func syncToolbar(_ model: AppModel) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
        Button {
            Task { await model.syncNow() }
        } label: {
            if model.syncing { ProgressView().controlSize(.small) }
            else { Image(systemName: "arrow.triangle.2.circlepath") }
        }
        .help(model.syncStatus ?? "Sync with server")
        .disabled(model.syncing)
    }
}
