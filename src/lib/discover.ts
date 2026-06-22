// Federated paper discovery across multiple sources (OpenAlex, Semantic Scholar,
// arXiv, Crossref). Each adapter returns normalized DiscoverHits; federatedSearch
// runs the selected sources in parallel, de-dupes by DOI/arXiv/title, and merges
// rankings with Reciprocal Rank Fusion. Web uses Vite proxies; native fetches
// directly (sources that lack CORS just yield no results, caught per-adapter).
import type { Paper } from "../types";
import { isTauri } from "./tauri";

export type SourceId = "openalex" | "semanticscholar" | "arxiv" | "crossref" | "huggingface";

export const SOURCES: { id: SourceId; label: string }[] = [
  { id: "openalex", label: "OpenAlex" },
  { id: "semanticscholar", label: "Semantic Scholar" },
  { id: "arxiv", label: "arXiv" },
  { id: "crossref", label: "Crossref" },
  { id: "huggingface", label: "Hugging Face" },
];

export interface DiscoverHit {
  id: string;
  source: SourceId;
  sources?: SourceId[];
  title: string;
  authorsShort: string;
  authorsFull: string;
  year: number;
  venue: string;
  doi: string;
  arxiv: string;
  abstract: string;
  tldr?: string;
  keywords?: string[];
  citedBy: number;
}

const MAILTO = "marginalia@example.com";
const root = (web: string, native: string) => (isTauri() ? native : web);

function shortAuthors(names: string[]): string {
  if (!names.length) return "Unknown";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}
const lastName = (full: string) => full.trim().split(/\s+/).pop() || full;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- OpenAlex ----------
function invertedToText(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
  return words.join(" ").replace(/\s+/g, " ").trim();
}
async function searchOpenAlex(query: string): Promise<DiscoverHit[]> {
  const base = root("/openalex", "https://api.openalex.org");
  const select =
    "id,title,display_name,publication_year,cited_by_count,doi,primary_location,authorships,abstract_inverted_index";
  const data: any = await getJson(
    `${base}/works?search=${encodeURIComponent(query)}&select=${select}&per_page=12&mailto=${MAILTO}`,
  );
  return (data.results ?? []).map((w: any): DiscoverHit => {
    const full = (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean);
    return {
      id: String(w.id || "").split("/").pop() || "",
      source: "openalex",
      title: w.title || w.display_name || "Untitled",
      authorsShort: shortAuthors(full.map(lastName)),
      authorsFull: full.join(", "),
      year: w.publication_year || 0,
      venue: w.primary_location?.source?.display_name || "—",
      doi: (w.doi || "").replace(/^https?:\/\/doi\.org\//, "") || "—",
      arxiv: "—",
      abstract: invertedToText(w.abstract_inverted_index),
      citedBy: w.cited_by_count || 0,
    };
  });
}

// ---------- Semantic Scholar ----------
const S2_FIELDS = "title,abstract,year,venue,authors,externalIds,citationCount,tldr";
// The recommendations endpoint accepts a SUBSET of paper fields — notably it
// rejects `tldr` (returns HTTP 400), unlike the search endpoint. Keep a separate
// list so a recommendations call never 400s on an unsupported field.
const S2_REC_FIELDS = "title,abstract,year,venue,authors,externalIds,citationCount";
function mapS2(p: any): DiscoverHit {
  const names = (p.authors ?? []).map((a: any) => a.name).filter(Boolean);
  return {
    id: p.paperId || "",
    source: "semanticscholar",
    title: p.title || "Untitled",
    authorsShort: shortAuthors(names.map(lastName)),
    authorsFull: names.join(", "),
    year: p.year || 0,
    venue: p.venue || "—",
    doi: p.externalIds?.DOI || "—",
    arxiv: p.externalIds?.ArXiv || "—",
    abstract: p.abstract || "",
    tldr: p.tldr?.text || undefined,
    citedBy: p.citationCount || 0,
  };
}
async function searchSemanticScholar(query: string): Promise<DiscoverHit[]> {
  const base = root("/semanticscholar", "https://api.semanticscholar.org");
  const data: any = await getJson(
    `${base}/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=12&fields=${S2_FIELDS}`,
  );
  return (data.data ?? []).map(mapS2);
}

// Semantic Scholar Recommendations API: "papers you should read" given seeds
// from the user's library. Seeds are addressed by arXiv id / DOI (no need to
// resolve to S2 ids first). Returns [] if no usable seeds or the API is down.
function s2SeedId(p: { doi: string; arxiv: string }): string | null {
  if (p.arxiv && p.arxiv !== "—") return `ArXiv:${p.arxiv}`;
  if (p.doi && p.doi !== "—") return `DOI:${p.doi}`;
  return null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET with one retry on 429 (the unauthenticated S2 pool is rate-limited).
async function s2Get(url: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(1300);
      continue;
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  throw new Error("429");
}

export async function recommendFromLibrary(
  seeds: { doi: string; arxiv: string }[],
  k = 12,
): Promise<DiscoverHit[]> {
  // The recommendations API only permits GET cross-origin (a POST batch request
  // is CORS-blocked in the native app — preflight allows GET,OPTIONS only). Query
  // the single-seed `forpaper` endpoint SEQUENTIALLY (avoids tripping the shared
  // rate limit) and stop as soon as we have enough; papers recommended for more
  // than one seed bubble to the top. Throws only if every seed call fails.
  //
  // We try up to 10 seeds because many seminal papers return ZERO recommendations
  // from this endpoint — if we only tried the first few we'd often show nothing
  // even when other papers in the library have plenty. Early-stop keeps it fast.
  const ids = [...new Set(seeds.map(s2SeedId).filter((x): x is string => !!x))].slice(0, 10);
  if (!ids.length) return [];
  const base = root("/semanticscholar", "https://api.semanticscholar.org");
  const score = new Map<string, number>();
  const byKey = new Map<string, DiscoverHit>();
  let failures = 0;
  for (const id of ids) {
    let list: DiscoverHit[] = [];
    try {
      const data = await s2Get(
        `${base}/recommendations/v1/papers/forpaper/${encodeURIComponent(id)}?fields=${S2_REC_FIELDS}&limit=${k}`,
      );
      list = ((data.recommendedPapers ?? []) as any[]).map(mapS2);
    } catch {
      failures++;
    }
    list.forEach((h, rank) => {
      const key =
        h.doi && h.doi !== "—"
          ? "doi:" + h.doi.toLowerCase()
          : h.arxiv && h.arxiv !== "—"
            ? "arx:" + h.arxiv.toLowerCase()
            : "id:" + h.id;
      score.set(key, (score.get(key) ?? 0) + 1 / (1 + rank));
      if (!byKey.has(key)) byKey.set(key, h);
    });
    if (byKey.size >= k) break; // enough — stop hitting the API
  }
  if (!byKey.size && failures === ids.length) throw new Error("recommendations unavailable");
  return [...byKey.keys()]
    .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))
    .map((key) => byKey.get(key)!)
    .slice(0, k);
}

// ---------- arXiv ----------
function xmlText(el: Element | null, sel: string): string {
  return el?.querySelector(sel)?.textContent?.trim().replace(/\s+/g, " ") || "";
}
async function searchArxiv(query: string): Promise<DiscoverHit[]> {
  const base = root("/arxiv-api", "https://export.arxiv.org");
  const res = await fetch(
    `${base}/api/query?search_query=all:${encodeURIComponent(query)}&max_results=12`,
  );
  if (!res.ok) throw new Error(`${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  return Array.from(xml.querySelectorAll("entry")).map((e): DiscoverHit => {
    const full = Array.from(e.querySelectorAll("author name"))
      .map((n) => n.textContent?.trim() || "")
      .filter(Boolean);
    const idUrl = xmlText(e, "id");
    const arxivId = (idUrl.match(/abs\/([^v]+)/)?.[1] || "").trim() || "—";
    const published = xmlText(e, "published");
    return {
      id: arxivId,
      source: "arxiv",
      title: xmlText(e, "title"),
      authorsShort: shortAuthors(full.map(lastName)),
      authorsFull: full.join(", "),
      year: published ? Number(published.slice(0, 4)) : 0,
      venue: "arXiv",
      doi: xmlText(e, "arxiv\\:doi") || "—",
      arxiv: arxivId,
      abstract: xmlText(e, "summary"),
      citedBy: 0,
    };
  });
}

// ---------- Crossref ----------
async function searchCrossref(query: string): Promise<DiscoverHit[]> {
  const base = root("/crossref", "https://api.crossref.org");
  const data: any = await getJson(
    `${base}/works?query=${encodeURIComponent(query)}&rows=12&select=DOI,title,author,issued,container-title,is-referenced-by-count&mailto=${MAILTO}`,
  );
  return (data.message?.items ?? []).map((w: any): DiscoverHit => {
    const full = (w.author ?? [])
      .map((a: any) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean);
    return {
      id: w.DOI || "",
      source: "crossref",
      title: (w.title?.[0] || "Untitled").replace(/\s+/g, " "),
      authorsShort: shortAuthors((w.author ?? []).map((a: any) => a.family || a.name || "").filter(Boolean)),
      authorsFull: full.join(", "),
      year: w.issued?.["date-parts"]?.[0]?.[0] || 0,
      venue: w["container-title"]?.[0] || "—",
      doi: w.DOI || "—",
      arxiv: "—",
      abstract: "",
      citedBy: w["is-referenced-by-count"] || 0,
    };
  });
}

// ---------- Hugging Face Papers (arXiv-backed; carries AI summary + keywords) ----------
function hfBase() {
  return root("/huggingface", "https://huggingface.co");
}
function mapHfPaper(p: any): DiscoverHit {
  const names = (p.authors ?? []).map((a: any) => a.name).filter(Boolean);
  return {
    id: p.id || "",
    source: "huggingface",
    title: (p.title || "Untitled").replace(/\s+/g, " "),
    authorsShort: shortAuthors(names.map(lastName)),
    authorsFull: names.join(", "),
    year: p.publishedAt ? Number(String(p.publishedAt).slice(0, 4)) : 0,
    venue: "arXiv · HF",
    doi: "—",
    arxiv: p.id || "—",
    abstract: (p.summary || "").replace(/\s+/g, " "),
    tldr: p.ai_summary || undefined,
    keywords: Array.isArray(p.ai_keywords) ? p.ai_keywords : undefined,
    citedBy: p.upvotes || 0,
  };
}
async function searchHuggingFace(query: string): Promise<DiscoverHit[]> {
  const data: any = await getJson(
    `${hfBase()}/api/papers/search?q=${encodeURIComponent(query)}`,
  );
  const arr = Array.isArray(data) ? data : [];
  return arr.slice(0, 20).map((it: any) => mapHfPaper(it.paper ?? it));
}
export async function trendingHuggingFace(): Promise<DiscoverHit[]> {
  const data: any = await getJson(`${hfBase()}/api/daily_papers?limit=30`);
  const arr = Array.isArray(data) ? data : [];
  return arr.map((it: any) => mapHfPaper(it.paper ?? it));
}

const ADAPTERS: Record<SourceId, (q: string) => Promise<DiscoverHit[]>> = {
  openalex: searchOpenAlex,
  semanticscholar: searchSemanticScholar,
  arxiv: searchArxiv,
  crossref: searchCrossref,
  huggingface: searchHuggingFace,
};

function dedupeKey(h: DiscoverHit): string {
  // Title first: it's the most consistent key across sources and doesn't change
  // when we backfill a doi/arxiv during merge (which would otherwise split scores).
  const t = h.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (t.length >= 8) return "t:" + t.slice(0, 80);
  if (h.doi && h.doi !== "—") return "doi:" + h.doi.toLowerCase();
  if (h.arxiv && h.arxiv !== "—") return "arx:" + h.arxiv;
  return "id:" + h.id;
}

// De-dupe + Reciprocal Rank Fusion merge across per-source ranked lists. Pure.
export function rrfMerge(lists: DiscoverHit[][]): DiscoverHit[] {
  const score = new Map<string, number>();
  const merged = new Map<string, DiscoverHit>();
  const srcs = new Map<string, Set<SourceId>>();
  const K = 60;

  lists.forEach((list) => {
    list.forEach((h, rank) => {
      const k = dedupeKey(h);
      score.set(k, (score.get(k) || 0) + 1 / (K + rank));
      const set = srcs.get(k) ?? new Set<SourceId>();
      set.add(h.source);
      srcs.set(k, set);
      const cur = merged.get(k);
      if (!cur) {
        merged.set(k, { ...h });
      } else {
        if ((!cur.abstract || cur.abstract.length < h.abstract.length) && h.abstract) cur.abstract = h.abstract;
        if (!cur.tldr && h.tldr) cur.tldr = h.tldr;
        if ((!cur.keywords || !cur.keywords.length) && h.keywords?.length) cur.keywords = h.keywords;
        if (cur.arxiv === "—" && h.arxiv !== "—") cur.arxiv = h.arxiv;
        if (cur.doi === "—" && h.doi !== "—") cur.doi = h.doi;
        if (h.citedBy > cur.citedBy) cur.citedBy = h.citedBy;
        if (cur.venue === "—" && h.venue !== "—") cur.venue = h.venue;
      }
    });
  });

  // Sort on the score captured by the ORIGINAL key — recomputing dedupeKey on a
  // merged hit can return a different key (doi/arxiv backfilled), losing its score.
  return [...merged.entries()]
    .map(([k, h]) => ({ hit: { ...h, sources: [...(srcs.get(k) || [])] }, sc: score.get(k) || 0 }))
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.hit);
}

// Federated search across selected sources, de-duped and RRF-merged.
export async function federatedSearch(query: string, sourceIds: SourceId[]): Promise<DiscoverHit[]> {
  const ids = sourceIds.length ? sourceIds : (Object.keys(ADAPTERS) as SourceId[]);
  const lists = await Promise.all(ids.map((id) => ADAPTERS[id](query).catch(() => [] as DiscoverHit[])));
  return rrfMerge(lists);
}

// Convert a discovery hit into a library Paper (arXiv id is kept so the reader
// can fetch the PDF).
export function hitToPaper(h: DiscoverHit): Paper {
  return {
    id: h.doi !== "—" ? h.doi : h.arxiv !== "—" ? h.arxiv : "oa:" + h.id,
    title: h.title,
    authors: h.authorsShort,
    authorsFull: h.authorsFull,
    year: h.year,
    venue: h.venue,
    doi: h.doi,
    arxiv: h.arxiv,
    tags: (h.keywords ?? []).slice(0, 6),
    read: false,
    fav: false,
    added: "discovered",
    addedTs: Date.now(),
    abstract: h.abstract || h.tldr || "",
    notes: "",
    hl: [],
    summary: h.tldr || undefined,
  };
}
