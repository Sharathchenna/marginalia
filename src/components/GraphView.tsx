import { useMemo, useState } from "react";
import type { Store } from "../store";
import type { Paper } from "../types";

// A connections graph: papers are placed on a circle, grouped so papers in the
// same collection / sharing a topic sit near each other. Edges come from shared
// tags (faint) and the manual "related" links you add (bold). Click a node to
// open it.
const W = 1000;
const H = 760;
const PALETTE = ["#4B57D6", "#2E9E6B", "#E0A23A", "#C0395E", "#7C84FF", "#3BA7C4", "#B5683A", "#8A57C9"];
const MAX_TAG_GROUP = 25; // skip ubiquitous tags — they'd connect everything to everything
const NEIGHBORS_PER_NODE = 4; // keep only each paper's strongest tag links, for readability

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function GraphView({ store: s }: { store: Store }) {
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, edges, linkCount } = useMemo(() => {
    const papers = s.papers;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 130;

    const collectionOf = (id: string) => s.collections.find((c) => c.ids.includes(id));
    // Cluster key groups papers on the ring: collection first, else primary tag.
    const clusterKey = (p: Paper) => collectionOf(p.id)?.name ?? p.tags[0] ?? "~";
    const colorOf = (p: Paper) => collectionOf(p.id)?.color ?? hashColor(clusterKey(p));

    // Order papers by cluster so connected ones land next to each other.
    const ordered = [...papers].sort(
      (a, b) => clusterKey(a).localeCompare(clusterKey(b)) || a.title.localeCompare(b.title),
    );

    const pos = new Map<string, { x: number; y: number }>();
    const nodes = ordered.map((p, i) => {
      const a = ordered.length ? (i / ordered.length) * Math.PI * 2 - Math.PI / 2 : 0;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      pos.set(p.id, { x, y });
      return { id: p.id, x, y, title: p.title, color: colorOf(p), fav: p.fav };
    });

    // Weighted tag co-occurrence: how many tags each pair of papers shares.
    const weight = new Map<string, number>();
    const tagMap = new Map<string, string[]>();
    for (const p of papers) {
      for (const t of p.tags) {
        const arr = tagMap.get(t);
        if (arr) arr.push(p.id);
        else tagMap.set(t, [p.id]);
      }
    }
    for (const ids of tagMap.values()) {
      if (ids.length < 2 || ids.length > MAX_TAG_GROUP) continue;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
          weight.set(key, (weight.get(key) ?? 0) + 1);
        }
    }
    // Keep only each node's strongest few tag links (avoids a hairball).
    const neigh = new Map<string, { other: string; w: number }[]>();
    for (const [key, w] of weight) {
      const [a, b] = key.split("|");
      (neigh.get(a) ?? neigh.set(a, []).get(a)!).push({ other: b, w });
      (neigh.get(b) ?? neigh.set(b, []).get(b)!).push({ other: a, w });
    }
    const tagEdgeKeys = new Set<string>();
    for (const [id, list] of neigh) {
      list.sort((x, y) => y.w - x.w);
      for (const { other } of list.slice(0, NEIGHBORS_PER_NODE)) {
        tagEdgeKeys.add(id < other ? `${id}|${other}` : `${other}|${id}`);
      }
    }

    // Manual "related" links — drawn bold; they win over a tag edge for the pair.
    const relKeys = new Set<string>();
    for (const p of papers)
      for (const rid of p.related ?? []) {
        relKeys.add(p.id < rid ? `${p.id}|${rid}` : `${rid}|${p.id}`);
      }

    const edges: { x1: number; y1: number; x2: number; y2: number; rel: boolean; a: string; b: string }[] = [];
    const pushEdge = (key: string, rel: boolean) => {
      const [a, b] = key.split("|");
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (pa && pb) edges.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, rel, a, b });
    };
    for (const key of relKeys) pushEdge(key, true);
    for (const key of tagEdgeKeys) if (!relKeys.has(key)) pushEdge(key, false);

    return { nodes, edges, linkCount: edges.length };
  }, [s.papers, s.collections]);

  const activeId = hover ?? s.selectedId;
  const isConnected = (a: string, b: string) =>
    !!activeId && (a === activeId || b === activeId);

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 1040 }}>
        <h1 className="page-title">Connections</h1>
        <p className="page-sub">
          {nodes.length} papers · {linkCount} link{linkCount === 1 ? "" : "s"}. Faint links join
          papers that share tags; bold links are the “Related” links you add. Hover to highlight,
          click a node to open it.
        </p>
        {nodes.length === 0 ? (
          <div className="fc-empty">No papers yet — add some to see how they connect.</div>
        ) : (
          <div className="graph-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg">
              {edges.map((e, i) => (
                <line
                  key={i}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  className={`graph-edge${e.rel ? " rel" : ""}`}
                  data-dim={activeId && !isConnected(e.a, e.b) ? "true" : undefined}
                />
              ))}
              {nodes.map((n) => {
                const active = n.id === activeId;
                const showLabel = active || n.fav;
                return (
                  <g
                    key={n.id}
                    className="graph-node"
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                    onClick={() => {
                      s.select(n.id);
                      s.goScreen("library");
                    }}
                  >
                    <title>{n.title}</title>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={active ? 11 : 7}
                      style={{ fill: n.color }}
                    />
                    {showLabel && (
                      <text x={n.x} y={n.y - 14} textAnchor="middle" className="graph-label">
                        {n.title.length > 30 ? n.title.slice(0, 30) + "…" : n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </main>
  );
}
