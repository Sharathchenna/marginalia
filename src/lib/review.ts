// Daily Review / resurfacing (Bet A). Surfaces past highlights and saved items so
// they don't rot in the library — modeled on Readwise's Daily Review (density-
// weighted highlight resurfacing) and a "recent / on-this-day / dormant" home.
// Uses Math.random — fine in app runtime (only Workflow scripts ban it).
import type { Paper } from "../types";

export interface SurfacedHighlight {
  paper: Paper;
  index: number;
  text: string;
  color: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Highlights to revisit: SRS-due ones first (recall ≤ ~50%, via the flashcard
 *  scheduler), then a density-weighted random fill (papers with more highlights
 *  naturally contribute more candidates). Image "highlights" (🖼) are skipped. */
export function surfaceHighlights(papers: Paper[], n: number, now: number): SurfacedHighlight[] {
  const all: SurfacedHighlight[] = [];
  for (const p of papers)
    p.hl.forEach((h, i) => {
      if (!h.text.startsWith("🖼")) all.push({ paper: p, index: i, text: h.text, color: h.color });
    });
  if (!all.length) return [];
  const key = (x: SurfacedHighlight) => x.paper.id + ":" + x.index;
  const due = all.filter((x) => {
    const c = x.paper.cards?.[x.index];
    return !!c && c.due <= now;
  });
  const dueKeys = new Set(due.map(key));
  const rest = shuffle(all.filter((x) => !dueKeys.has(key(x))));
  return [...shuffle(due), ...rest].slice(0, n);
}

/** Saved-and-forgotten items: added a while ago, still unread, not favorited. */
export function surfaceDormant(papers: Paper[], n: number, now: number): Paper[] {
  const CUTOFF = 21 * 86400000;
  const candidates = papers.filter((p) => !p.read && !p.fav && now - p.addedTs > CUTOFF);
  return shuffle(candidates).slice(0, n);
}

/** Items saved on this calendar day in a previous year ("On this day"). */
export function surfaceOnThisDay(papers: Paper[], now: number): Paper[] {
  const d = new Date(now);
  return papers
    .filter((p) => {
      const pd = new Date(p.addedTs);
      return (
        pd.getMonth() === d.getMonth() &&
        pd.getDate() === d.getDate() &&
        pd.getFullYear() < d.getFullYear()
      );
    })
    .sort((a, b) => b.addedTs - a.addedTs);
}
