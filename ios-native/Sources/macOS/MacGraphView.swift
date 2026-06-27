import SwiftUI

// Connections: a force-directed graph of papers linked by shared tags. The layout
// runs once in a fixed virtual space and is stored as UNIT coordinates (0…1); the
// Canvas maps those to the live canvas size at draw time, so the graph always fills
// the column (and survives resizes) without re-simulating. Click a node to open it.
struct MacGraphView: View {
    @Environment(AppModel.self) private var model

    @State private var nodes: [GNode] = []
    @State private var edges: [(Int, Int)] = []

    struct GNode: Identifiable {
        let id: Int
        let paperId: String
        let label: String
        let degree: Int
        var x: CGFloat   // unit 0…1
        var y: CGFloat   // unit 0…1
    }

    var body: some View {
        GeometryReader { geo in
            let margin: CGFloat = 70
            let w = max(geo.size.width - 2 * margin, 1)
            let h = max(geo.size.height - 2 * margin, 1)
            let pos = { (n: GNode) in CGPoint(x: margin + n.x * w, y: margin + n.y * h) }

            Canvas { ctx, _ in
                for (a, b) in edges where a < nodes.count && b < nodes.count {
                    var path = Path()
                    path.move(to: pos(nodes[a]))
                    path.addLine(to: pos(nodes[b]))
                    ctx.stroke(path, with: .color(.secondary.opacity(0.25)), lineWidth: 1)
                }
                for n in nodes {
                    let c = pos(n)
                    let r = 5 + CGFloat(min(n.degree, 8)) * 1.6
                    ctx.fill(Circle().path(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                             with: .color(.accentColor))
                    if n.degree >= 1 {
                        ctx.draw(Text(n.label).font(.caption2).foregroundStyle(.secondary),
                                 at: CGPoint(x: c.x, y: c.y + r + 9))
                    }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { loc in
                if let hit = nodes.min(by: { hypot(pos($0).x - loc.x, pos($0).y - loc.y) < hypot(pos($1).x - loc.x, pos($1).y - loc.y) }),
                   hypot(pos(hit).x - loc.x, pos(hit).y - loc.y) < 30 {
                    // Open the paper: select it and leave the graph so the detail
                    // column shows the reader.
                    model.selectedId = hit.paperId
                    model.screen = .library
                }
            }
        }
        .overlay(alignment: .bottom) {
            Text("\(nodes.count) papers · \(edges.count) links")
                .font(.caption).foregroundStyle(.secondary).padding(8)
        }
        .navigationTitle("Connections")
        .toolbar { syncToolbar(model) }
        .onAppear { if nodes.isEmpty { layout() } }
        .onChange(of: model.papers.count) { _, _ in layout() }
    }

    private func layout() {
        let papers = model.papers.filter { $0.itemKind == .paper }.prefix(60).map { $0 }
        guard !papers.isEmpty else { nodes = []; edges = []; return }

        // Edges: papers sharing at least one tag.
        var e: [(Int, Int)] = []
        for i in papers.indices {
            for j in papers.indices where j > i {
                if !papers[i].tags.isEmpty, !Set(papers[i].tags).isDisjoint(with: Set(papers[j].tags)) {
                    e.append((i, j))
                }
            }
        }
        var degree = Array(repeating: 0, count: papers.count)
        for (a, b) in e { degree[a] += 1; degree[b] += 1 }

        // Force sim in a fixed virtual space.
        let W: CGFloat = 1000, H: CGFloat = 700
        let cx = W / 2, cy = H / 2, radius = min(W, H) * 0.42
        var pts = papers.indices.map { i -> CGPoint in
            let a = CGFloat(i) / CGFloat(papers.count) * 2 * .pi
            return CGPoint(x: cx + cos(a) * radius, y: cy + sin(a) * radius)
        }
        for _ in 0..<260 {
            var disp = Array(repeating: CGVector.zero, count: pts.count)
            for i in pts.indices {
                for j in pts.indices where j != i {
                    let dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y
                    let d = max(hypot(dx, dy), 0.5)
                    let rep = 6000 / d
                    disp[i].dx += dx / d * rep; disp[i].dy += dy / d * rep
                }
            }
            for (a, b) in e {
                let dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y
                let d = max(hypot(dx, dy), 0.5)
                let spring = (d - 120) * 0.04
                disp[a].dx += dx / d * spring; disp[a].dy += dy / d * spring
                disp[b].dx -= dx / d * spring; disp[b].dy -= dy / d * spring
            }
            // Gravity keeps the cloud (and isolated nodes) centered + bounded.
            for i in pts.indices {
                disp[i].dx += (cx - pts[i].x) * 0.02
                disp[i].dy += (cy - pts[i].y) * 0.02
            }
            for i in pts.indices {
                pts[i].x += max(-20, min(20, disp[i].dx))
                pts[i].y += max(-20, min(20, disp[i].dy))
            }
        }

        // Normalize the bounding box to unit [0,1] coords; the Canvas scales to fit.
        let xs = pts.map(\.x), ys = pts.map(\.y)
        let minX = xs.min() ?? 0, maxX = xs.max() ?? 1
        let minY = ys.min() ?? 0, maxY = ys.max() ?? 1
        let spanX = max(maxX - minX, 1), spanY = max(maxY - minY, 1)
        nodes = papers.indices.map { i in
            GNode(id: i, paperId: papers[i].id,
                  label: String((papers[i].authors.split(separator: " ").first ?? "").prefix(12)),
                  degree: degree[i],
                  x: (pts[i].x - minX) / spanX,
                  y: (pts[i].y - minY) / spanY)
        }
        edges = e
    }
}
