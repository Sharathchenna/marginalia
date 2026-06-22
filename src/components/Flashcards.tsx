import { useEffect, useMemo, useState } from "react";
import type { Store } from "../store";

interface Card {
  paperId: string;
  idx: number;
  text: string;
  note: string;
  page: number;
  color: string;
  paperTitle: string;
}

// Build the due queue once per session: every highlight is a card; due when its
// scheduled time has passed (new cards are due immediately).
function buildQueue(store: Store): Card[] {
  const now = Date.now();
  const out: Card[] = [];
  for (const p of store.papers) {
    p.hl.forEach((h, idx) => {
      const due = p.cards?.[idx]?.due ?? 0;
      if (due <= now) {
        out.push({
          paperId: p.id,
          idx,
          text: h.text,
          note: h.note,
          page: h.page,
          color: h.color,
          paperTitle: p.title,
        });
      }
    });
  }
  return out;
}

export function Flashcards({ store: s }: { store: Store }) {
  const totalCards = useMemo(
    () => s.papers.reduce((n, p) => n + p.hl.length, 0),
    [s.papers],
  );
  // snapshot the due queue at mount so it doesn't reshuffle as we review
  const [queue, setQueue] = useState<Card[]>(() => buildQueue(s));
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const card = queue[i];
  const done = i >= queue.length;

  const grade = (g: "again" | "good" | "easy") => {
    const c = queue[i];
    if (!c) return;
    s.reviewCard(c.paperId, c.idx, g);
    // "Again" → re-show this card a few positions later, this same session
    if (g === "again") {
      setQueue((q) => {
        const nq = q.slice();
        nq.splice(Math.min(i + 3, nq.length), 0, c);
        return nq;
      });
    }
    setRevealed(false);
    setI((n) => n + 1);
  };

  // keyboard: Space/Enter reveals, then 1=Again 2=Good 3=Easy
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) return;
      if (done || !card) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        grade(e.key === "1" ? "again" : e.key === "2" ? "good" : "easy");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, done, card, i, queue]);

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 640 }}>
        <h1 className="page-title">Flashcards</h1>
        <p className="page-sub">
          Spaced-repetition review of your highlights. {totalCards} card{totalCards === 1 ? "" : "s"} total.
        </p>

        {totalCards === 0 ? (
          <div className="fc-empty">
            Highlight passages while reading — they become review cards here.
          </div>
        ) : done ? (
          <div className="fc-empty">
            <div style={{ fontSize: 30, marginBottom: 10 }}>✓</div>
            All caught up — no cards due right now.
            <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-3)" }}>
              Reviewed {queue.length} card{queue.length === 1 ? "" : "s"} this session.
            </div>
          </div>
        ) : (
          <>
            <div className="fc-progress">
              {i + 1} / {queue.length} due
            </div>
            <div className="fc-card" style={{ borderTop: `4px solid ${card.color}` }}>
              <div className="fc-front">“{card.text}”</div>
              {revealed ? (
                <div className="fc-back">
                  {card.note && <p className="fc-note">{card.note}</p>}
                  <p className="fc-source">
                    {card.paperTitle} · p.{card.page}
                  </p>
                </div>
              ) : (
                <button className="btn-go fc-reveal" onClick={() => setRevealed(true)}>
                  Show answer <kbd style={{ marginLeft: 6 }}>space</kbd>
                </button>
              )}
            </div>

            {revealed && (
              <div className="fc-grades">
                <button className="fc-grade again" onClick={() => grade("again")}>Again <kbd>1</kbd></button>
                <button className="fc-grade good" onClick={() => grade("good")}>Good <kbd>2</kbd></button>
                <button className="fc-grade easy" onClick={() => grade("easy")}>Easy <kbd>3</kbd></button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
