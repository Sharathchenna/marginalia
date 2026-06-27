import { useEffect, useMemo, useRef } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import type { Store } from "../store";
import type { Paper } from "../types";

// Obsidian-style connections graph: a force-directed layout on a canvas. Papers
// repel each other while shared tags / AI concepts / manual "Related" links pull
// them together, so topics self-organize into clusters. Drag a node, pan the
// canvas, scroll to zoom; hover a paper to spotlight its neighbours; click to open.

const PALETTE = ["#4B57D6", "#2E9E6B", "#E0A23A", "#C0395E", "#7C84FF", "#3BA7C4", "#B5683A", "#8A57C9"];
const MAX_TAG_GROUP = 25; // skip ubiquitous tags — they'd connect everything
const NEIGHBORS_PER_NODE = 5; // keep each paper's strongest links (avoids a hairball)

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface GNode {
  id: string;
  title: string;
  color: string;
  r: number;
  fav: boolean;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  rel: boolean;
}

export function GraphView({ store: s }: { store: Store }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest store for event handlers, so the simulation effect doesn't re-run
  // (and reset the layout) on every parent render.
  const storeRef = useRef(s);
  storeRef.current = s;

  // Build nodes + links from the library (collection/topic colour, weighted
  // shared-tag/concept edges capped per node, plus bold manual "Related" links).
  const graph = useMemo(() => {
    const papers = s.papers;
    const collectionOf = (id: string) => s.collections.find((c) => c.ids.includes(id));
    const clusterKey = (p: Paper) => collectionOf(p.id)?.name ?? p.tags[0] ?? "~";
    const colorOf = (p: Paper) => collectionOf(p.id)?.color ?? hashColor(clusterKey(p));

    const weight = new Map<string, number>();
    const accumulate = (getKeys: (p: Paper) => string[], perPair: number) => {
      const map = new Map<string, string[]>();
      for (const p of papers)
        for (const k of getKeys(p)) {
          const norm = k.toLowerCase().trim();
          if (!norm) continue;
          (map.get(norm) ?? map.set(norm, []).get(norm)!).push(p.id);
        }
      for (const ids of map.values()) {
        if (ids.length < 2 || ids.length > MAX_TAG_GROUP) continue;
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
            weight.set(key, (weight.get(key) ?? 0) + perPair);
          }
      }
    };
    accumulate((p) => p.concepts ?? [], 2);
    accumulate((p) => p.tags, 1);

    // Keep only each node's strongest few tag/concept links.
    const neigh = new Map<string, { other: string; w: number }[]>();
    for (const [key, w] of weight) {
      const [a, b] = key.split("|");
      (neigh.get(a) ?? neigh.set(a, []).get(a)!).push({ other: b, w });
      (neigh.get(b) ?? neigh.set(b, []).get(b)!).push({ other: a, w });
    }
    const edgeKeys = new Set<string>();
    for (const [id, list] of neigh) {
      list.sort((x, y) => y.w - x.w);
      for (const { other } of list.slice(0, NEIGHBORS_PER_NODE))
        edgeKeys.add(id < other ? `${id}|${other}` : `${other}|${id}`);
    }
    const relKeys = new Set<string>();
    for (const p of papers)
      for (const rid of p.related ?? [])
        if (papers.some((x) => x.id === rid))
          relKeys.add(p.id < rid ? `${p.id}|${rid}` : `${rid}|${p.id}`);

    const links: GLink[] = [];
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const key of relKeys) {
      const [a, b] = key.split("|");
      links.push({ source: a, target: b, rel: true });
      bump(a);
      bump(b);
    }
    for (const key of edgeKeys) {
      if (relKeys.has(key)) continue;
      const [a, b] = key.split("|");
      links.push({ source: a, target: b, rel: false });
      bump(a);
      bump(b);
    }

    const nodes: GNode[] = papers.map((p) => {
      const d = degree.get(p.id) ?? 0;
      return { id: p.id, title: p.title, color: colorOf(p), fav: p.fav, r: 5 + Math.sqrt(d) * 2.2 };
    });

    // Adjacency for hover spotlighting.
    const adj = new Map<string, Set<string>>();
    for (const l of links) {
      const a = l.source as string;
      const b = l.target as string;
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
    }
    return { nodes, links, adj };
  }, [s.papers, s.collections]);

  const linkCount = graph.links.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Theme-aware colours pulled from the app's CSS variables.
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const C = {
      edge: v("--border-2", "#dcdce1"),
      edgeStrong: v("--accent", "#4b57d6"),
      text: v("--text-2", "#5b5d66"),
      textStrong: v("--text-1", "#1b1c21"),
      ring: v("--accent", "#4b57d6"),
      stroke: v("--bg-content", "#ffffff"),
    };

    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    const view = { scale: 0.9, tx: 0, ty: 0 };
    let hover: string | null = null;

    const sim: Simulation<GNode, GLink> = forceSimulation(graph.nodes)
      .force("charge", forceManyBody<GNode>().strength(-260).distanceMax(700))
      .force(
        "link",
        forceLink<GNode, GLink>(graph.links)
          .id((d) => d.id)
          .distance((l) => (l.rel ? 48 : 92))
          .strength((l) => (l.rel ? 0.55 : 0.16)),
      )
      .force("collide", forceCollide<GNode>((d) => d.r + 5))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.02))
      .force("y", forceY(0).strength(0.02))
      .on("tick", draw);

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      // center the origin in the viewport
      view.tx = width / 2;
      view.ty = height / 2;
      draw();
    }

    // graph→screen helpers
    const sx = (x: number) => x * view.scale + view.tx;
    const sy = (y: number) => y * view.scale + view.ty;

    function draw() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const neighbors = hover ? graph.adj.get(hover) : null;
      const lit = (id: string) => !hover || id === hover || !!neighbors?.has(id);

      // edges
      ctx.lineWidth = 1;
      for (const l of graph.links) {
        const a = l.source as GNode;
        const b = l.target as GNode;
        if (a.x == null || b.x == null) continue;
        const on = !hover || a.id === hover || b.id === hover;
        ctx.globalAlpha = on ? (l.rel ? 0.85 : 0.5) : 0.06;
        ctx.strokeStyle = l.rel ? C.edgeStrong : C.edge;
        ctx.lineWidth = l.rel ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y!));
        ctx.lineTo(sx(b.x), sy(b.y!));
        ctx.stroke();
      }

      // nodes
      const showAllLabels = view.scale > 1.25;
      for (const n of graph.nodes) {
        if (n.x == null || n.y == null) continue;
        const on = lit(n.id);
        const x = sx(n.x);
        const y = sy(n.y);
        const r = n.r * view.scale;
        ctx.globalAlpha = on ? 1 : 0.18;
        // halo on the hovered node
        if (n.id === hover) {
          ctx.beginPath();
          ctx.arc(x, y, r + 5, 0, Math.PI * 2);
          ctx.fillStyle = C.ring;
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.stroke;
        ctx.stroke();

        // labels: when zoomed in, or favourite, or hovered/neighbour
        if (on && (showAllLabels || n.fav || (hover && (n.id === hover || neighbors?.has(n.id))))) {
          const fs = Math.max(10, 11);
          ctx.globalAlpha = n.id === hover ? 1 : 0.85;
          ctx.font = `${fs}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = n.id === hover ? C.textStrong : C.text;
          const label = n.title.length > 28 ? n.title.slice(0, 28) + "…" : n.title;
          ctx.fillText(label, x, y + r + fs + 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- interaction ----
    const toGraph = (clientX: number, clientY: number) => {
      const rect = canvas!.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return { gx: (px - view.tx) / view.scale, gy: (py - view.ty) / view.scale, px, py };
    };
    const nodeAt = (gx: number, gy: number): GNode | null => {
      let best: GNode | null = null;
      let bestD = Infinity;
      for (const n of graph.nodes) {
        if (n.x == null || n.y == null) continue;
        const d = Math.hypot(n.x - gx, n.y - gy);
        const hit = n.r + 6 / view.scale;
        if (d < hit && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    let drag: { node: GNode | null; lastX: number; lastY: number; moved: boolean } | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { px, py } = toGraph(e.clientX, e.clientY);
      const gx = (px - view.tx) / view.scale;
      const gy = (py - view.ty) / view.scale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      view.scale = Math.min(4, Math.max(0.2, view.scale * factor));
      view.tx = px - gx * view.scale;
      view.ty = py - gy * view.scale;
      draw();
    };
    const onPointerDown = (e: PointerEvent) => {
      canvas!.setPointerCapture(e.pointerId);
      const { gx, gy } = toGraph(e.clientX, e.clientY);
      const node = nodeAt(gx, gy);
      drag = { node, lastX: e.clientX, lastY: e.clientY, moved: false };
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        sim.alphaTarget(0.3).restart();
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) {
        const { gx, gy } = toGraph(e.clientX, e.clientY);
        const h = nodeAt(gx, gy)?.id ?? null;
        if (h !== hover) {
          hover = h;
          canvas!.style.cursor = h ? "pointer" : "grab";
          draw();
        }
        return;
      }
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (drag.node) {
        drag.node.fx = (drag.node.fx ?? 0) + dx / view.scale;
        drag.node.fy = (drag.node.fy ?? 0) + dy / view.scale;
      } else {
        view.tx += dx;
        view.ty += dy;
        draw();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!drag) return;
      const wasClick = !drag.moved && drag.node;
      if (drag.node) {
        drag.node.fx = null;
        drag.node.fy = null;
        sim.alphaTarget(0);
      }
      if (wasClick && drag.node) {
        storeRef.current.select(drag.node.id);
        storeRef.current.goScreen("library");
      }
      drag = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    sim.alpha(1).restart();

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.style.cursor = "grab";

    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [graph, s.theme]);

  return (
    <main className="page-scroll">
      <div className="page-inner graph-page" style={{ maxWidth: 1100 }}>
        <h1 className="page-title">Connections</h1>
        <p className="page-sub">
          {graph.nodes.length} papers · {linkCount} link{linkCount === 1 ? "" : "s"}. Papers pull
          together by shared tags &amp; concepts; bold links are your “Related” links. Drag to
          rearrange, scroll to zoom, hover to focus, click to open.
        </p>
        {graph.nodes.length === 0 ? (
          <div className="fc-empty">No papers yet — add some to see how they connect.</div>
        ) : (
          <div ref={wrapRef} className="graph-canvas-wrap">
            <canvas ref={canvasRef} />
          </div>
        )}
      </div>
    </main>
  );
}
