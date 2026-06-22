import type { Paper } from "../types";

// Lightweight ranked full-text search over the library. Tokenizes the query,
// scores each paper by weighted field matches (title > tags/authors > abstract)
// with a prefix-match fallback, and returns matches best-first. This is the
// in-memory equivalent of the SQLite FTS5 index used by the native backend.
//
// Supports field-scoped operators: author:, tag:, venue:, title:, year: (exact,
// range "2018-2022", or "<=2020"/">=2020"), and in:<field> to restrict the free
// terms to one field.
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

interface FieldTerm {
  field: string;
  value: string;
}
const KNOWN_FIELDS = new Set(["author", "authors", "year", "tag", "tags", "venue", "title", "in"]);

// Split a raw query into field-scoped terms (author:foo, year:2017, "in:abstract")
// and plain free tokens. Quoted values ("a b") are kept whole for field terms.
function parseQuery(raw: string): { free: string[]; fields: FieldTerm[] } {
  const fields: FieldTerm[] = [];
  const free: string[] = [];
  const re = /(\w+):(?:"([^"]*)"|(\S+))|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1]) {
      const field = m[1].toLowerCase();
      const value = (m[2] ?? m[3] ?? "").toLowerCase();
      if (KNOWN_FIELDS.has(field) && value) fields.push({ field, value });
      else free.push(...tokenize(m[1] + " " + (m[2] ?? m[3] ?? "")));
    } else {
      free.push(...tokenize(m[4] ?? m[5] ?? ""));
    }
  }
  return { free: [...new Set(free)], fields };
}

function fieldText(p: Paper, f: string): string {
  switch (f) {
    case "title":
      return p.title;
    case "abstract":
      return p.abstract;
    case "author":
    case "authors":
      return p.authors + " " + p.authorsFull;
    case "tag":
    case "tags":
      return p.tags.join(" ");
    case "venue":
      return p.venue;
    case "notes":
      return p.notes;
    case "concepts":
      return (p.concepts ?? []).join(" ");
    default:
      return p.title + " " + p.abstract;
  }
}

function matchYear(year: number, v: string): boolean {
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})\s*-\s*(\d{4})$/))) return year >= +m[1] && year <= +m[2];
  if ((m = v.match(/^>=?\s*(\d{4})$/))) return year >= +m[1];
  if ((m = v.match(/^<=?\s*(\d{4})$/))) return year <= +m[1];
  if ((m = v.match(/^(\d{4})$/))) return year === +m[1];
  return false; // unrecognized year filter shouldn't silently match every paper
}

function matchField(p: Paper, t: FieldTerm): boolean {
  const v = t.value;
  switch (t.field) {
    case "year":
      return matchYear(p.year, v);
    case "tag":
    case "tags":
      return p.tags.some((x) => x.toLowerCase().includes(v));
    default:
      return fieldText(p, t.field).toLowerCase().includes(v);
  }
}

export function scorePaper(p: Paper, tokens: string[], inField?: string): number {
  if (!tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    let best: number;
    if (inField) {
      best = fieldScore(fieldText(p, inField), t) * 3;
    } else {
      const title = fieldScore(p.title, t) * 5;
      const tags = fieldScore(p.tags.join(" "), t) * 3;
      const authors = fieldScore(p.authors + " " + p.authorsFull, t) * 3;
      const venue = fieldScore(p.venue, t) * 2;
      const concepts = fieldScore((p.concepts ?? []).join(" "), t) * 3;
      const abstract = fieldScore(p.abstract, t) * 1;
      const full = p.fulltext ? fieldScore(p.fulltext, t) * 0.5 : 0;
      best = title + tags + authors + venue + concepts + abstract + full;
    }
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
  // length >= 2 keeps short but meaningful tokens like RL / AI / ML.
  const tokens = [...new Set(tokenize(query))].filter((t) => t.length >= 2 && !STOPWORDS.has(t));
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
  const { free, fields } = parseQuery(query);
  const inField = fields.find((f) => f.field === "in")?.value;
  const constraints = fields.filter((f) => f.field !== "in");
  if (!free.length && !constraints.length) {
    return papers.map((p) => ({
      paper: p,
      score: 0,
      snippet: p.authors + " · " + p.venue,
    }));
  }
  return papers
    .filter((p) => constraints.every((c) => matchField(p, c)))
    .map((p) => ({
      paper: p,
      score: free.length ? scorePaper(p, free, inField) : 1,
      snippet: makeSnippet(p, free),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.paper.addedTs - a.paper.addedTs);
}
