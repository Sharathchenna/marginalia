# Plan — A good research-paper search engine for Marginalia

Goal: let a researcher **find** papers (not just browse the ones they already
have), then add the good ones to their local library in one click. This is a
*discovery* engine layered on top of the existing local FTS5 search.

There are two distinct search problems; we want both:

1. **Local search** — search *your* library. Already implemented (ranked search
   in `src/lib/search.ts`, SQLite FTS5 natively). Fast, offline, private.
2. **Discovery search** — search *the literature* (tens of millions of papers)
   across scholarly APIs, then triage results into the library. This plan is
   mostly about (2), with hybrid/semantic upgrades that also improve (1).

---

## 1. Sources (federate several — no single index is complete)

| Source | Why | Key | Notes |
|---|---|---|---|
| **OpenAlex** | 250M+ works, CC0, rich metadata, citations, concepts, OA links | none | Primary. "Polite pool" via `mailto`. |
| **Semantic Scholar** | TLDR summaries, paper embeddings (SPECTER2), citation graph | free key | Great for "similar"/semantic + influence. |
| **arXiv** | Preprints, full-text PDFs | none | Already wired for metadata + PDF. |
| **Crossref** | Authoritative DOIs/venues, published versions | none | Already wired. De-dupe anchor. |
| **PubMed / DBLP** | Domain coverage (bio / CS) | none | Add later, opt-in by field. |

**Federation strategy:** query the enabled sources **in parallel**, normalize
each result into one shape (the existing `Paper` plus `citations`, `oaUrl`,
`source`), then **de-duplicate** and **merge-rank**.

- De-dupe key priority: `DOI` → `arXiv id` → normalized `(title + year)` (lowercased,
  punctuation-stripped, author-last-name check to avoid title collisions).
- Merge identical hits across sources into one record, keeping the richest fields
  and recording which sources matched (a cross-source hit is a relevance signal).

---

## 2. Query understanding

- **Fielded query parser**: `attention author:vaswani year:2017..2020 venue:neurips
  tag:rl open:true`. Reuse the same grammar the ⌘K palette filters hint at
  (`author:`, `year:`, `tag:`, `in:abstract`). Unparsed terms → free text.
- **Free text** → each source's native relevance query.
- **Semantic mode** (toggle): embed the query and rank by vector similarity
  (see §4) instead of / in addition to keyword match.

---

## 3. Ranking (the part that makes it "good")

Per-source results already come ranked, but each scale differs. Combine them with
**Reciprocal Rank Fusion (RRF)** — robust, parameter-light, no score
normalization needed:

```
rrf(doc) = Σ_sources  1 / (k + rank_in_source)        // k ≈ 60
```

Then apply signal boosts to the fused score:

```
score = rrf
      + w_cite   · log1p(citationCount)        // impact
      + w_recent · recencyDecay(year)          // freshness (half-life ~4 yrs)
      + w_match  · queryTermCoverage(title)    // title hits matter most
      + w_sem    · cosine(queryEmbedding, docEmbedding)   // semantic (§4)
      + w_pers   · personalization(doc)        // overlap with your library/tags
```

- `personalization`: boost results sharing tags/authors/venues with the user's
  library and collections — cheap, local, and high-value.
- Weights start hand-tuned, later learned (§6). Expose a couple as UI toggles
  ("sort by: relevance / citations / date").

---

## 4. Semantic search (hybrid retrieval)

Keyword search misses paraphrases; semantic search misses exact terms. Use
**both** (hybrid) and fuse with RRF.

- **Embeddings**: SPECTER2 / `bge-small` (scientific-tuned). Options:
  - cloud (Workers AI / OpenAI embeddings) — simplest;
  - **local** via `candle`/`ort` in Rust or `transformers.js` in the webview —
    keeps it local-first (preferred long-term).
- **Vector store**: `sqlite-vec` (or `sqlite-vss`) in the same SQLite DB → no new
  infra, stays local. Index every library paper's title+abstract on import.
- **Capabilities unlocked**:
  - "**Find similar**" to any paper in the library (nearest neighbors).
  - Semantic discovery: embed the query, ANN search over a cached corpus +
    Semantic Scholar's `/recommendations`.
  - Better local search: hybrid keyword+vector over your own library.

---

## 5. Citation-graph navigation

From OpenAlex / Semantic Scholar:

- **References** (what this cites) and **citations** (what cites this).
- "**Key papers**": most-cited references, or highly-cited citing works.
- Pull these on demand from the detail panel ("12 references · 340 citations →").
- Snowball discovery: expand a seed set along the graph to surface a field.

---

## 6. Architecture in the app

```
Discover screen (new)  ──>  search service  ──>  provider adapters
  query bar + facets         (federate,            OpenAlexAdapter
  result list + "Add"         dedupe, RRF,          SemanticScholarAdapter
  "similar to…"               re-rank)              ArxivAdapter / CrossrefAdapter
                                   │
                                   ├─ embeddings (similar / semantic)
                                   └─ cache + rate-limit (SQLite)
```

- **Adapter interface** mirrors `src/lib/metadata.ts`: `search(query, opts) →
  NormalizedResult[]`. Each adapter owns its endpoint, paging, and field mapping.
- **Native (Rust)** does the HTTP, caching, rate-limit/backoff, and vector math
  (commands: `discover(query, sources)`, `find_similar(paperId)`,
  `citations(id)`); the **web** build hits the same APIs via Vite proxies for dev.
- **Add-to-library** reuses the existing pipeline: a result → `lookupIdentifier`
  enrich → `addPaper` → (native) download PDF into the library folder.
- **Caching & etiquette**: cache responses in SQLite keyed by `(source, query,
  page)` with TTL; set a `User-Agent`/`mailto` for OpenAlex+Crossref polite
  pools; exponential backoff on 429; cap parallel requests per source.
- **Privacy note**: discovery queries leave the device (they hit external APIs).
  The library itself is never uploaded. Surface this clearly; allow disabling
  individual sources.

---

## 7. Evaluation (know if it's actually good)

- Build a small **gold set**: ~30 queries → known-relevant papers.
- Track **nDCG@10, MRR, Recall@20** as ranking changes land.
- A/B the weight vector; later, learn weights from **click/add feedback**
  (which results the user actually adds is a strong relevance label) via a simple
  learning-to-rank model.

---

## 8. Phased rollout

1. **Federated keyword discovery** — OpenAlex + arXiv + Crossref adapters,
   parallel fetch, DOI/arXiv/title de-dupe, RRF merge. New **Discover** screen
   with facets (year, venue, OA) and one-click Add. *(Biggest value, no ML.)*
2. **Signal re-ranking** — citation count, recency, fielded query parser,
   personalization boost from the local library.
3. **Citation graph** — references/citations in the detail panel + snowballing.
4. **Semantic/hybrid** — embeddings + `sqlite-vec`, "Find similar", hybrid local
   search, Semantic Scholar recommendations.
5. **Feedback-learned ranking** — log adds/clicks, learn weights; offline eval
   harness with the gold set.
6. **More sources & polish** — PubMed/DBLP by field, saved searches + alerts
   ("notify me of new papers matching X").

---

## Recommended first step

Implement **Phase 1** with **OpenAlex as the single primary source** (free, no
key, excellent metadata and an easy REST API), behind an adapter interface, on a
new Discover screen — then add arXiv/Crossref to the same federation and turn on
RRF. That delivers a genuinely useful discovery search in the smallest slice,
and every later phase (semantic, graph, learned ranking) builds on the same
adapter + ranking seam.
