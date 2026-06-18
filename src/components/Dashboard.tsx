import { useMemo } from "react";
import type { Store } from "../store";
import type { ReadingStatus } from "../types";
import { LibraryRecommendations } from "./Recommendations";

function effStatus(read: boolean, status?: ReadingStatus): ReadingStatus {
  return status ?? (read ? "done" : "unread");
}

export function Dashboard({ store: s }: { store: Store }) {
  const stats = useMemo(() => {
    const papers = s.papers;
    const highlights = papers.reduce((n, p) => n + p.hl.length, 0);
    const done = papers.filter((p) => effStatus(p.read, p.status) === "done").length;
    const reading = papers.filter((p) => effStatus(p.read, p.status) === "reading");
    const recent = [...papers].sort((a, b) => b.addedTs - a.addedTs).slice(0, 5);
    const tagFreq = new Map<string, number>();
    for (const p of papers) for (const t of p.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const withNotes = papers.filter((p) => p.notes.trim()).length;
    return { total: papers.length, highlights, done, reading, recent, topTags, withNotes };
  }, [s.papers]);

  const card = (label: string, value: number | string, onClick?: () => void) => (
    <button className="stat-card" onClick={onClick} disabled={!onClick}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </button>
  );

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 860 }}>
        <h1 className="page-title">Your library</h1>
        <p className="page-sub">{stats.total} papers · {stats.highlights} highlights · {stats.done} read</p>

        <div className="stat-grid">
          {card("Papers", stats.total, () => s.pickFilter("all"))}
          {card("In queue", s.counts.queue, () => s.pickFilter("queue"))}
          {card("Read", stats.done)}
          {card("Highlights", stats.highlights, () => s.goScreen("flashcards"))}
          {card("Favorites", s.counts.fav, () => s.pickFilter("fav"))}
          {card("Untagged", s.counts.untagged)}
        </div>

        {s.counts.untagged > 0 && (
          <div className="dash-banner">
            <span>
              {s.counts.untagged} paper{s.counts.untagged === 1 ? "" : "s"} have no tags.
              Let Claude categorise them — it reuses your existing tags, fills in
              missing authors/venue from the PDF, and files each paper into a
              collection by topic.
            </span>
            <button className="btn-primary" disabled={s.bulkBusy} onClick={s.autoTagUntagged}>
              {s.bulkBusy ? <span className="spinner" /> : "🏷"} Auto-tag all
            </button>
          </div>
        )}

        {stats.reading.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">Continue reading</h2>
            <div className="dash-list">
              {stats.reading.map((p) => (
                <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                  <span className="dash-item-title">{p.title}</span>
                  <span className="dash-item-meta">{p.authors} · {p.year || "—"}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="dash-section">
          <h2 className="dash-h2">Recently added</h2>
          <div className="dash-list">
            {stats.recent.map((p) => (
              <button
                key={p.id}
                className="dash-item"
                onClick={() => {
                  s.select(p.id);
                  s.goScreen("library");
                }}
              >
                <span className="dash-item-title">{p.title}</span>
                <span className="dash-item-meta">{p.authors} · {p.year || "—"} · {p.added}</span>
              </button>
            ))}
            {stats.recent.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>Nothing yet — import or discover papers.</span>
            )}
          </div>
        </section>

        {stats.topTags.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">Top tags</h2>
            <div className="tag-wrap" style={{ padding: 0 }}>
              {stats.topTags.map(([t, n]) => (
                <button key={t} className="tag-chip" onClick={() => s.pickFilter("tag:" + t)}>
                  {t} <span style={{ opacity: 0.5 }}>{n}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {stats.total > 0 && <LibraryRecommendations store={s} />}

        <div style={{ display: "flex", gap: 9, marginTop: 28, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={s.importFiles}>Import PDFs</button>
          <button className="btn-ghost" onClick={() => s.openDiscover()}>Discover papers</button>
          <button className="btn-ghost" onClick={s.openIdentifier}>Add by ID</button>
          <button
            className="btn-ghost"
            disabled={s.bulkBusy || stats.total === 0}
            onClick={s.autoTagUntagged}
            title="Let Claude tag untagged papers and file them into collections by topic"
          >
            {s.bulkBusy ? <span className="spinner" /> : "🏷"} Auto-tag all
          </button>
        </div>
      </div>
    </main>
  );
}
