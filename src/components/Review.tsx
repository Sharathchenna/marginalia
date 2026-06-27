import { useMemo, useState } from "react";
import type { Store } from "../store";
import {
  surfaceDormant,
  surfaceHighlights,
  surfaceOnThisDay,
  type SurfacedHighlight,
} from "../lib/review";
import { articleHost, isArticle } from "../lib/items";
import { relativeTime } from "../lib/time";

export function Review({ store: s }: { store: Store }) {
  // Snapshot the session once so grading/dismissing doesn't reshuffle the list.
  const [now] = useState(() => Date.now());
  const [hl, setHl] = useState<SurfacedHighlight[]>(() => surfaceHighlights(s.papers, 12, now));
  const dormant = useMemo(() => surfaceDormant(s.papers, 6, now), [s.papers, now]);
  const onThisDay = useMemo(() => surfaceOnThisDay(s.papers, now), [s.papers, now]);

  const grade = (h: SurfacedHighlight, g: "again" | "good" | "easy") => {
    s.reviewCard(h.paper.id, h.index, g);
    setHl((q) => q.filter((x) => !(x.paper.id === h.paper.id && x.index === h.index)));
  };

  const meta = (p: SurfacedHighlight["paper"]) =>
    isArticle(p) ? articleHost(p) : p.authors;

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 760 }}>
        <h1 className="page-title">Daily Review</h1>
        <p className="page-sub">
          Resurface what you've saved and highlighted, so it doesn't just rot in the library.
        </p>

        <section className="dash-section">
          <h2 className="dash-h2">Highlights to revisit{hl.length ? ` · ${hl.length}` : ""}</h2>
          {hl.length === 0 ? (
            <p className="desc" style={{ marginTop: 0 }}>
              {s.papers.some((p) => p.hl.length)
                ? "All caught up for now. ✨"
                : "Highlight while you read and they'll resurface here."}
            </p>
          ) : (
            <div className="review-list">
              {hl.map((h) => (
                <div
                  key={h.paper.id + ":" + h.index}
                  className="review-card"
                  style={{ borderLeft: `3px solid ${h.color}` }}
                >
                  <p className="review-quote">"{h.text}"</p>
                  <div className="review-foot">
                    <button className="review-src" onClick={() => s.openReader(h.paper.id)} title={h.paper.title}>
                      {h.paper.title.length > 56 ? h.paper.title.slice(0, 56) + "…" : h.paper.title}
                      <span className="review-src-meta"> · {meta(h.paper)}</span>
                    </button>
                    <div className="spacer" />
                    <button className="mini-btn muted" onClick={() => grade(h, "again")}>Again</button>
                    <button className="mini-btn" onClick={() => grade(h, "good")}>✓ Got it</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {dormant.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">Saved &amp; forgotten</h2>
            <p className="desc" style={{ marginTop: 0 }}>Older saves you haven't read yet.</p>
            <div className="dash-list">
              {dormant.map((p) => (
                <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                  <span className="dash-item-title">{p.title}</span>
                  <span className="dash-item-meta">
                    {meta(p)} · saved {relativeTime(p.addedTs) || p.added}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {onThisDay.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-h2">On this day</h2>
            <div className="dash-list">
              {onThisDay.map((p) => (
                <button key={p.id} className="dash-item" onClick={() => s.openReader(p.id)}>
                  <span className="dash-item-title">{p.title}</span>
                  <span className="dash-item-meta">
                    {meta(p)} · {new Date(p.addedTs).getFullYear()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
