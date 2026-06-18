import { useEffect, useState } from "react";
import type { Store } from "../store";
import type { Paper } from "../types";
import {
  hitToPaper,
  recommendForLibrary,
  similarPapers,
  type DiscoverHit,
} from "../lib/discover";

// Shared card list used by both the per-paper and library recommenders.
function RecoList({ store: s, hits, max }: { store: Store; hits: DiscoverHit[]; max: number }) {
  const shown = hits.filter((h) => !s.hasPaper(hitToPaper(h).id)).slice(0, max);
  if (shown.length === 0) return <div className="reco-empty">Nothing new to recommend right now.</div>;
  return (
    <div className="reco-list">
      {shown.map((h) => {
        const p = hitToPaper(h);
        return (
          <div key={h.source + ":" + h.id} className="reco-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="reco-title">{h.title}</div>
              <div className="reco-meta">
                {h.authorsShort} · {h.year || "—"}
                {h.citedBy > 0 && ` · ${h.citedBy.toLocaleString()} votes`}
                {h.arxiv !== "—" && " · PDF"}
              </div>
              {h.tldr && <div className="reco-tldr">{h.tldr.slice(0, 160)}{h.tldr.length > 160 ? "…" : ""}</div>}
            </div>
            <button className="mini-btn" disabled={s.hasPaper(p.id)} onClick={() => s.addPaper(p)}>
              {s.hasPaper(p.id) ? "✓" : "+ Add"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Phase 2 — papers similar to the open paper (alphaXiv recommender). Auto-loads
// when the paper has an arXiv id.
export function PaperRecommendations({ store: s, paper }: { store: Store; paper: Paper }) {
  const arxiv = paper.arxiv && paper.arxiv !== "—" ? paper.arxiv : "";
  const [hits, setHits] = useState<DiscoverHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!arxiv) return;
    let alive = true;
    setBusy(true);
    setErr("");
    setHits([]);
    similarPapers(arxiv)
      .then((r) => alive && setHits(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Couldn't load recommendations"))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [arxiv]);

  if (!arxiv) return null;
  return (
    <div className="detail-section">
      <h3>Recommended (alphaXiv)</h3>
      {busy && <div className="reco-empty"><span className="spinner" /> Finding similar papers…</div>}
      {err && <div className="reco-empty">{err}</div>}
      {!busy && !err && <RecoList store={s} hits={hits} max={6} />}
    </div>
  );
}

// Phase 3 — recommendations pooled across your recent papers. Loaded on demand
// (it fans out several requests), shown on the dashboard.
export function LibraryRecommendations({ store: s }: { store: Store }) {
  const [hits, setHits] = useState<DiscoverHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const seeds = [...s.papers]
      .filter((p) => p.arxiv && p.arxiv !== "—")
      .sort((a, b) => b.addedTs - a.addedTs)
      .slice(0, 8)
      .map((p) => p.arxiv);
    if (seeds.length === 0) {
      setErr("Add a few arXiv papers first — recommendations are based on them.");
      setHits([]);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      setHits(await recommendForLibrary(seeds));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load recommendations");
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dash-section">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 className="dash-h2">Recommended for you</h2>
        <button className="mini-btn" disabled={busy} onClick={load}>
          {busy ? <span className="spinner" /> : hits ? "↻ Refresh" : "✨ Find papers"}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "2px 0 10px" }}>
        Based on your recent arXiv papers, via alphaXiv.
      </p>
      {err && <div className="reco-empty">{err}</div>}
      {hits && !err && <RecoList store={s} hits={hits} max={12} />}
    </section>
  );
}
