// Duplicate detection + merge for the library. Three signals, strongest first:
//   1. identical DOI (deterministic)
//   2. identical arXiv id (deterministic)
//   3. near-identical normalized title + same year (fuzzy)
// Embedding similarity is handled separately in Rust; this pure module needs no
// network and works in both backends, so it's the always-available baseline.
import type { Paper } from "../types";

export interface DuplicateGroup {
  /** Why these were grouped: "doi" | "arxiv" | "title". */
  reason: string;
  papers: Paper[];
}

const clean = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");

function titleKey(p: Paper): string | null {
  const t = clean(p.title);
  if (t.length < 10) return null; // too short to trust
  return `${t.slice(0, 90)}|${p.year || 0}`;
}

// Group papers that share a strong identity signal. A paper joins at most one
// group, checked DOI → arXiv → title so the strongest reason wins.
export function findDuplicates(papers: Paper[]): DuplicateGroup[] {
  const buckets = new Map<string, { reason: string; ids: Set<string>; papers: Paper[] }>();
  const place = (key: string, reason: string, p: Paper) => {
    const b = buckets.get(key) ?? { reason, ids: new Set<string>(), papers: [] };
    if (!b.ids.has(p.id)) {
      b.ids.add(p.id);
      b.papers.push(p);
    }
    buckets.set(key, b);
  };
  const claimed = new Set<string>();

  // DOI then arXiv (deterministic, never collide across reasons).
  for (const p of papers) {
    if (p.doi && p.doi !== "—") place(`doi:${p.doi.toLowerCase()}`, "doi", p), claimed.add(p.id);
  }
  for (const p of papers) {
    if (claimed.has(p.id)) continue;
    if (p.arxiv && p.arxiv !== "—") place(`arx:${p.arxiv.toLowerCase()}`, "arxiv", p), claimed.add(p.id);
  }
  // Fuzzy title for whatever's left.
  for (const p of papers) {
    if (claimed.has(p.id)) continue;
    const k = titleKey(p);
    if (k) place(`title:${k}`, "title", p);
  }

  return [...buckets.values()]
    .filter((b) => b.papers.length > 1)
    .map((b) => ({ reason: b.reason, papers: b.papers }));
}

// A crude "how complete is this record" score, to pick which paper to keep.
function completeness(p: Paper): number {
  let n = 0;
  if (p.abstract) n += 2;
  if (p.authorsFull) n += 1;
  if (p.doi && p.doi !== "—") n += 1;
  if (p.arxiv && p.arxiv !== "—") n += 1;
  if (p.venue && p.venue !== "—") n += 1;
  if (p.year) n += 1;
  if (p.summary) n += 1;
  if (p.fulltext) n += 1;
  if (p.file) n += 2;
  n += (p.tags?.length || 0) * 0.2;
  n += (p.hl?.length || 0) * 0.5;
  return n;
}

const dedupeStrings = (arr: (string | undefined)[]) =>
  [...new Set(arr.filter((x): x is string => !!x))];

// Merge a group into the most-complete record. Returns the surviving (merged)
// paper plus the ids that should be deleted. The keeper's id is preserved so
// links/collection memberships pointing at it stay valid.
export function mergePapers(group: Paper[]): { merged: Paper; dropIds: string[] } {
  const sorted = [...group].sort((a, b) => completeness(b) - completeness(a));
  const keep = sorted[0];
  const rest = sorted.slice(1);
  const pick = <K extends keyof Paper>(k: K, bad?: Paper[K]): Paper[K] => {
    for (const p of sorted) {
      const v = p[k];
      if (v !== undefined && v !== "" && v !== bad) return v;
    }
    return keep[k];
  };

  // Highlights are concatenated in `sorted` order; flashcard SRS state (`cards`)
  // is keyed by highlight index, so re-key each paper's cards by the cumulative
  // highlight offset — otherwise every paper's review history but the keeper's is
  // lost on merge.
  type Card = NonNullable<Paper["cards"]>[number];
  const mergedCards: Record<number, Card> = {};
  let hlOffset = 0;
  for (const p of sorted) {
    if (p.cards) {
      for (const [idx, card] of Object.entries(p.cards)) {
        mergedCards[Number(idx) + hlOffset] = card;
      }
    }
    hlOffset += p.hl?.length || 0;
  }

  const merged: Paper = {
    ...keep,
    abstract: pick("abstract", "") as string,
    summary: pick("summary", "") as string | undefined,
    venue: pick("venue", "—") as string,
    doi: pick("doi", "—") as string,
    arxiv: pick("arxiv", "—") as string,
    authorsFull: pick("authorsFull", "") as string,
    file: pick("file", "") as string | undefined,
    pdfUrl: pick("pdfUrl", "") as string | undefined,
    fulltext: pick("fulltext", "") as string | undefined,
    year: Math.max(...group.map((p) => p.year || 0)) || keep.year,
    read: group.some((p) => p.read),
    fav: group.some((p) => p.fav),
    tags: dedupeStrings(group.flatMap((p) => p.tags || [])),
    concepts: dedupeStrings(group.flatMap((p) => p.concepts || [])),
    related: dedupeStrings(group.flatMap((p) => p.related || [])).filter((id) => id !== keep.id),
    hl: sorted.flatMap((p) => p.hl || []),
    cards: Object.keys(mergedCards).length ? mergedCards : undefined,
    retracted: group.map((p) => p.retracted).find(Boolean) ?? keep.retracted,
  };

  return { merged, dropIds: rest.map((p) => p.id) };
}
