import SwiftUI

// Connections: a force-directed graph of papers linked by shared tags. Layout is
// computed once (simple spring/repulsion), then drawn with Canvas; click a node to
// open it. Mirrors GraphView (desktop's Obsidian-style graph, scaled down).
struct MacGraphView: View {
    @Environment(AppModel.self) private var model

    @State private var nodes: [GNode] = []
    @State private var edges: [(Int, Int)] = []
    @State private var size: CGSize = .zero

    struct GNode: Identifiable {
        let id: Int
        let paperId: String
        let label: String
        let degree: Int
        var x: CGFloat
        var y: CGFloat
    }

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, _ in
                for (a, b) in edges where a < nodes.count && b < nodes.count {
                    var path = Path()
                    path.move(to: CGPoint(x: nodes[a].x, y: nodes[a].y))
                    path.addLine(to: CGPoint(x: nodes[b].x, y: nodes[b].y))
                    ctx.stroke(path, with: .color(.secondary.opacity(0.25)), lineWidth: 1)
                }
                for n in nodes {
                    let r = 5 + CGFloat(min(n.degree, 8)) * 1.5
                    let rect = CGRect(x: n.x - r, y: n.y - r, width: r * 2, height: r * 2)
                    ctx.fill(Circle().path(in: rect), with: .color(.accentColor))
                    if n.degree > 1 {
                        ctx.draw(Text(n.label).font(.caption2).foregroundStyle(.secondary),
                                 at: CGPoint(x: n.x, y: n.y + r + 7))
                    }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { loc in
                if let hit = nodes.min(by: { hypot($0.x - loc.x, $0.y - loc.y) < hypot($1.x - loc.x, $1.y - loc.y) }),
                   hypot(hit.x - loc.x, hit.y - loc.y) < 22 {
                    model.selectedId = hit.paperId
                }
            }
            .onChange(of: geo.size) { _, s in if nodes.isEmpty { layout(in: s) } }
            .onAppear { layout(in: geo.size) }
        }
        .overlay(alignment: .bottom) {
            Text("\(nodes.count) papers · \(edges.count) links")
                .font(.caption).foregroundStyle(.secondary).padding(6)
        }
        .navigationTitle("Connections")
        .toolbar { syncToolbar(model) }
    }

    private func layout(in s: CGSize) {
        guard s.width > 0 else { return }
        size = s
        let papers = model.papers.filter { $0.itemKind == .paper }.prefix(60).map { $0 }
        guard !papers.isEmpty else { nodes = []; edges = []; return }

        // Edges: papers sharing at least one tag.
        var e: [(Int, Int)] = []
        for i in papers.indices {
            for j in papers.indices where j > i {
                if !Set(papers[i].tags).isDisjoint(with: Set(papers[j].tags)), !papers[i].tags.isEmpty {
                    e.append((i, j))
                }
            }
        }
        var degree = Array(repeating: 0, count: papers.count)
        for (a, b) in e { degree[a] += 1; degree[b] += 1 }

        // Seed on a circle, then relax with repulsion + spring along edges.
        let cx = s.width / 2, cy = s.height / 2
        let radius = min(s.width, s.height) * 0.38
        var pts = papers.indices.map { i -> CGPoint in
            let a = CGFloat(i) / CGFloat(papers.count) * 2 * .pi
            return CGPoint(x: cx + cos(a) * radius, y: cy + sin(a) * radius)
        }
        for _ in 0..<220 {
            var disp = Array(repeating: CGVector.zero, count: pts.count)
            for i in pts.indices {
                for j in pts.indices where j != i {
                    let dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y
                    let d = max(hypot(dx, dy), 0.5)
                    let rep = 1400 / (d * d)
                    disp[i].dx += dx / d * rep
                    disp[i].dy += dy / d * rep
                }
            }
            for (a, b) in e {
                let dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y
                let d = max(hypot(dx, dy), 0.5)
                let spring = (d - 70) * 0.02
                disp[a].dx += dx / d * spring; disp[a].dy += dy / d * spring
                disp[b].dx -= dx / d * spring; disp[b].dy -= dy / d * spring
            }
            for i in pts.indices {
                pts[i].x = min(max(pts[i].x + max(-8, min(8, disp[i].dx)), 20), s.width - 20)
                pts[i].y = min(max(pts[i].y + max(-8, min(8, disp[i].dy)), 20), s.height - 28)
            }
        }
        nodes = papers.indices.map { i in
            GNode(id: i, paperId: papers[i].id,
                  label: String((papers[i].authors.split(separator: " ").first ?? "").prefix(12)),
                  degree: degree[i], x: pts[i].x, y: pts[i].y)
        }
        edges = e
    }
}
