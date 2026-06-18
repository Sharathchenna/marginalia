import type { Paper } from "../types";

// Lightweight ranked full-text search over the library. Tokenizes the query,
// scores each paper by weighted field matches (title > tags/authors > abstract)
// with a prefix-match fallback, and returns matches best-first. This is the
// in-memory equivalent of the SQLite FTS5 index used by the native backend.
export interface SearchHit {
  paper: Paper;
  score: number;
  snippet: string;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function fieldScore(haystack: string, token: string): number {
  const h = haystack.toLowerCase();
  if (h.includes(token)) return 1;
  // prefix match on any word
  if (h.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 0.5;
  return 0;
}

export function scorePaper(p: Paper, tokens: string[]): number {
  if (!tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    const title = fieldScore(p.title, t) * 5;
    const tags = fieldScore(p.tags.join(" "), t) * 3;
    const authors = fieldScore(p.authors + " " + p.authorsFull, t) * 3;
    const venue = fieldScore(p.venue, t) * 2;
    const concepts = fieldScore((p.concepts ?? []).join(" "), t) * 3;
    const abstract = fieldScore(p.abstract, t) * 1;
    const full = p.fulltext ? fieldScore(p.fulltext, t) * 0.5 : 0;
    const best = title + tags + authors + venue + concepts + abstract + full;
    if (best === 0) return 0; // every token must match somewhere (AND semantics)
    score += best;
  }
  return score;
}

function makeSnippet(p: Paper, tokens: string[]): string {
  const text = p.abstract;
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return p.authors + " · " + p.venue;
  const start = Math.max(0, idx - 30);
  return (start > 0 ? "…" : "") + text.slice(start, idx + 90);
}

// Common words that carry no retrieval signal in a natural-language question.
const STOPWORDS = new Set(
  ("a an and are as at be by do does for from has have how in into is it its of on or " +
    "that the to was what when where which who why with you your about can could should would " +
    "papers paper this these those there their them they we our us my").split(" "),
);

// RAG-lite retrieval for "Ask your library": rank the WHOLE library against a
// natural-language question (OR semantics, stopwords dropped) and return the
// most relevant papers. Returns [] when nothing matches so the caller can fall
// back to the current filter. Concepts and cached full text add signal.
export function retrieveForChat(papers: Paper[], query: string, k = 14): Paper[] {
  const tokens = [...new Set(tokenize(query))].filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!tokens.length) return [];
  return papers
    .map((p) => {
      let score = 0;
      for (const t of tokens) {
        score += fieldScore(p.title, t) * 5;
        score += fieldScore((p.concepts ?? []).join(" "), t) * 4;
        score += fieldScore(p.tags.join(" "), t) * 3;
        score += fieldScore(p.authors + " " + p.authorsFull, t) * 2;
        score += fieldScore(p.abstract, t) * 1.5;
        if (p.summary) score += fieldScore(p.summary, t) * 1.5;
        if (p.fulltext) score += fieldScore(p.fulltext, t) * 0.5;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.addedTs - a.p.addedTs)
    .slice(0, k)
    .map((x) => x.p);
}

export function searchPapers(papers: Paper[], query: string): SearchHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return papers.map((p) => ({
      paper: p,
      score: 0,
      snippet: p.authors + " · " + p.venue,
    }));
  }
  return papers
    .map((p) => ({ paper: p, score: scorePaper(p, tokens), snippet: makeSnippet(p, tokens) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.paper.addedTs - a.paper.addedTs);
}
