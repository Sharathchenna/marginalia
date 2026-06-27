import { useEffect, useMemo } from "react";
import type { Store } from "../store";
import type { ReadingStatus } from "../types";
import { relativeTime } from "../lib/time";
import { readingPct } from "../lib/reading";
import { articleHost, isArticle, itemSource } from "../lib/items";

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
    const articles = papers.filter(isArticle);
    const unreadBookmarks = articles
      .filter((p) => itemSource(p) !== "feed" && !p.read && !p.archived)
      .sort((a, b) => b.addedTs - a.addedTs)
      .slice(0, 5);
    const feedPosts = articles
      .filter((p) => itemSource(p) === "feed" && !p.read && !p.archived)
      .sort((a, b) => (b.publishedTs ?? b.addedTs) - (a.publishedTs ?? a.addedTs))
      .slice(0, 6);
    const paperCount = papers.length - articles.length;
    return {
      total: papers.length,
      paperCount,
      highlights,
      done,
      reading,
      recent,
      topTags,
      withNotes,
      unreadBookmarks,
      feedPosts,
    };
  }, [s.papers]);

  // Load "papers you should read" once when the dashboard first has a library.
  const loadRecs = s.loadRecommendations;
  useEffect(() => {
    if (s.papers.length > 0 && s.recs.length === 0) void loadRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.papers.length]);

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
        <p className="page-sub">
          {stats.paperCount} papers · {s.counts.articles} articles · {stats.highlights} highlights
        </p>

        <div className="stat-grid">
          {card("Papers", stats.paperCount, () => s.pickFilter("all"))}
          {card("Inbox", s.counts.queue, () => s.pickFilter("queue"))}
          {card("Bookmarks", s.counts.bookmarks, () => s.pickFilter("bookmarks"))}
          {card("Feed unread", s.counts.feedsUnread, () => s.goScreen("feeds"))}
          {card("Highlights", stats.highlights, () => s.goScreen("flashcards"))}
          {card("Favorites", s.counts.fav, () => s.pickFilter("fav"))}
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

        {stats.total > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Recommended for you
              {s.recsLoading && <span className="spinner" />}
              <button
                className="mini-btn muted"
                style={{ marginLeft: "auto" }}
                disabled={s.recsLoading}
                onClick={s.loadRecommendations}
              >
                ↻ Refresh
              </button>
            </h2>
            <p className="desc" style={{ marginTop: 0 }}>
              From Semantic Scholar, based on your favorites and recent reads.
            </p>
            {!s.recsLoading && s.recs.length === 0 && (
              <p className="desc" style={{ margin: "6px 0 0", color: "var(--text-3)" }}>
                {s.recsError || "No recommendations yet."}
              </p>
            )}
            <div className="dash-list">
              {s.recs.map((h) => (
                <div key={h.id} className="dash-item" style={{ cursor: "default" }}>
                  <span className="dash-item-title">{h.title}</span>
                  <span className="dash-item-meta">
                    {h.authorsShort} · {h.year || "—"}
                    {h.citedBy ? ` · ${h.citedBy} citations` : ""}
                  </span>
                  {h.tldr && (
                    <span className="dash-item-meta" style={{ marginTop: 4, color: "var(--text-2)" }}>
                      {h.tldr.length > 160 ? h.tldr.slice(0, 160) + "…" : h.tldr}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                    <button className="mini-btn" onClick={() => s.addDiscovered(h)}>
                      + Add
                    </button>
                    {(h.arxiv !== "—" || h.doi !== "—") && (
                      <button
                        className="mini-btn muted"
                        onClick={() =>
                          s.openExternal(
                            h.arxiv !== "—"
                              ? `https://arxiv.org/abs/${h.arxiv}`
                              : `https://doi.org/${h.doi}`,
                          )
                        }
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats.reading.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">Continue reading</h2>
            <div className="dash-list">
              {stats.reading.map((p) => {
                const pct = readingPct(p);
                return (
                  <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                    <span className="dash-item-title">{p.title}</span>
                    <span className="dash-item-meta">
                      {p.authors} · {p.year || "—"}
                      {pct !== null ? ` · ${pct}% read` : ""}
                    </span>
                    {pct !== null && (
                      <div className="progress-track" style={{ marginTop: 7 }}>
                        <div className="progress-bar" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {stats.feedPosts.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Latest from your feeds
              <button className="mini-btn muted" style={{ marginLeft: "auto" }} onClick={() => s.goScreen("feeds")}>
                Open feeds →
              </button>
            </h2>
            <div className="dash-list">
              {stats.feedPosts.map((p) => (
                <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                  <span className="dash-item-title">{p.title}</span>
                  <span className="dash-item-meta">
                    {articleHost(p)} · {relativeTime(p.publishedTs ?? p.addedTs) || "recent"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {stats.unreadBookmarks.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">Unread bookmarks</h2>
            <div className="dash-list">
              {stats.unreadBookmarks.map((p) => (
                <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                  <span className="dash-item-title">{p.title}</span>
                  <span className="dash-item-meta">
                    {articleHost(p)}
                    {p.readingTime ? ` · ${p.readingTime} min read` : ""}
                  </span>
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
                <span className="dash-item-meta">{p.authors} · {p.year || "—"} · {relativeTime(p.addedTs) || p.added}</span>
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
