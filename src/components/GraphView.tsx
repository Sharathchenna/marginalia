import { useMemo } from "react";
import type { Store } from "../store";

// A lightweight connections graph: nodes are papers placed on a circle, edges
// are the manual "related" links you've added. Click a node to open it.
const W = 1000;
const H = 720;

export function GraphView({ store: s }: { store: Store }) {
  const { nodes, edges } = useMemo(() => {
    const papers = s.papers;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 120;
    const colorOf = (id: string) =>
      s.collections.find((c) => c.ids.includes(id))?.color ?? "var(--text-3)";
    const pos = new Map<string, { x: number; y: number }>();
    const nodes = papers.map((p, i) => {
      const a = papers.length ? (i / papers.length) * Math.PI * 2 - Math.PI / 2 : 0;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      pos.set(p.id, { x, y });
      return { id: p.id, x, y, title: p.title, color: colorOf(p.id), fav: p.fav };
    });
    const seen = new Set<string>();
    const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const p of papers) {
      for (const rid of p.related ?? []) {
        const key = [p.id, rid].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = pos.get(p.id);
        const b = pos.get(rid);
        if (a && b) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return { nodes, edges };
  }, [s.papers, s.collections]);

  const linkCount = edges.length;

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 1040 }}>
        <h1 className="page-title">Connections</h1>
        <p className="page-sub">
          {nodes.length} papers · {linkCount} link{linkCount === 1 ? "" : "s"}. Add links from a
          paper's “Related” section; click a node to open it.
        </p>
        <div className="graph-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg">
            {edges.map((e, i) => (
              <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="graph-edge" />
            ))}
            {nodes.map((n) => (
              <g
                key={n.id}
                className="graph-node"
                onClick={() => {
                  s.select(n.id);
                  s.goScreen("library");
                }}
              >
                <circle cx={n.x} cy={n.y} r={n.id === s.selectedId ? 11 : 7} fill={n.color} />
                <text x={n.x} y={n.y - 14} textAnchor="middle" className="graph-label">
                  {n.title.length > 28 ? n.title.slice(0, 28) + "…" : n.title}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </main>
  );
}
