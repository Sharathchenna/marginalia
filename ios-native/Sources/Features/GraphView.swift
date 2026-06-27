import SwiftUI

// Connections — a native force-directed graph of papers linked by shared tags,
// drawn in a Canvas. The native analogue of the d3 GraphView.tsx.
struct GraphNode: Identifiable {
    let id: String
    let title: String
    let colorHex: String
    var x: Double
    var y: Double
}

struct GraphView: View {
    @Environment(AppModel.self) private var model
    @State private var nodes: [GraphNode] = []
    @State private var edges: [(Int, Int)] = []
    @State private var laidOut = false

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in
                for (a, b) in edges where a < nodes.count && b < nodes.count {
                    var path = Path()
                    path.move(to: pt(nodes[a], size))
                    path.addLine(to: pt(nodes[b], size))
                    ctx.stroke(path, with: .color(.gray.opacity(0.22)), lineWidth: 1)
                }
                for n in nodes {
                    let p = pt(n, size)
                    let r: CGFloat = 7
                    ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                             with: .color(Color(hex: n.colorHex)))
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onEnded { v in hitTest(v.location, geo.size) })
            .onAppear { if !laidOut { layout(); laidOut = true } }
        }
        .navigationTitle("Connections")
        .overlay(alignment: .bottom) {
            if nodes.isEmpty {
                ContentUnavailableView("No connections", systemImage: "point.3.connected.trianglepath.dotted",
                                       description: Text("Tag papers to see how they link."))
            } else {
                Text("\(nodes.count) papers · \(edges.count) links").font(.caption2).foregroundStyle(.secondary)
                    .padding(6).background(.bar, in: Capsule()).padding(.bottom, 8)
            }
        }
    }

    private func pt(_ n: GraphNode, _ size: CGSize) -> CGPoint {
        CGPoint(x: n.x * size.width, y: n.y * size.height)
    }

    private func hitTest(_ loc: CGPoint, _ size: CGSize) {
        var best: (String, Double)?
        for n in nodes {
            let p = pt(n, size)
            let d = (p.x - loc.x) * (p.x - loc.x) + (p.y - loc.y) * (p.y - loc.y)
            if d < 900, best == nil || d < best!.1 { best = (n.id, d) }
        }
        if let id = best?.0 { model.openReader(id) }
    }

    private func layout() {
        let papers = model.papers.filter { $0.itemKind == .paper }.prefix(60).map { $0 }
        guard !papers.isEmpty else { nodes = []; edges = []; return }
        let n = papers.count
        var xs = [Double](repeating: 0, count: n)
        var ys = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let a = Double(i) / Double(n) * 2 * .pi
            xs[i] = 0.5 + 0.4 * cos(a)
            ys[i] = 0.5 + 0.4 * sin(a)
        }
        // edges by shared tag (deduped, capped)
        var tagMap: [String: [Int]] = [:]
        for (i, p) in papers.enumerated() { for t in p.tags { tagMap[t, default: []].append(i) } }
        var pairs = Set<[Int]>()
        for (_, idxs) in tagMap where idxs.count > 1 {
            for a in 0..<idxs.count { for b in (a + 1)..<idxs.count {
                pairs.insert([min(idxs[a], idxs[b]), max(idxs[a], idxs[b])])
                if pairs.count > 200 { break }
            } }
        }
        let edgeList = pairs.map { ($0[0], $0[1]) }

        // simple force-directed iteration in unit space
        for _ in 0..<300 {
            var fx = [Double](repeating: 0, count: n)
            var fy = [Double](repeating: 0, count: n)
            for i in 0..<n { for j in (i + 1)..<n {
                let dx = xs[i] - xs[j], dy = ys[i] - ys[j]
                let d2 = max(dx * dx + dy * dy, 0.0005)
                let f = 0.0008 / d2
                let d = d2.squareRoot()
                fx[i] += dx / d * f; fy[i] += dy / d * f
                fx[j] -= dx / d * f; fy[j] -= dy / d * f
            } }
            for (a, b) in edgeList {
                let dx = xs[a] - xs[b], dy = ys[a] - ys[b]
                let d = max((dx * dx + dy * dy).squareRoot(), 0.001)
                let f = 0.01 * (d - 0.12)
                fx[a] -= dx / d * f; fy[a] -= dy / d * f
                fx[b] += dx / d * f; fy[b] += dy / d * f
            }
            for i in 0..<n {
                fx[i] += (0.5 - xs[i]) * 0.01
                fy[i] += (0.5 - ys[i]) * 0.01
                xs[i] += max(-0.05, min(0.05, fx[i]))
                ys[i] += max(-0.05, min(0.05, fy[i]))
            }
        }
        // normalize to [0.08, 0.92]
        let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
        let sx = max(maxX - minX, 0.001), sy = max(maxY - minY, 0.001)
        nodes = papers.enumerated().map { i, p in
            GraphNode(id: p.id, title: p.title,
                      colorHex: p.tags.isEmpty ? "#8A8A8A" : colorFor(p.tags[0]),
                      x: 0.08 + (xs[i] - minX) / sx * 0.84,
                      y: 0.08 + (ys[i] - minY) / sy * 0.84)
        }
        edges = edgeList
    }

    private func colorFor(_ tag: String) -> String {
        let palette = ["#4B57D6", "#D6634B", "#3FA34D", "#B5489A", "#C99A28", "#2E8C9E"]
        return palette[abs(tag.hashValue) % palette.count]
    }
}
