# Plan — Integrate the alphaXiv recommender

**Feasible — and the core recommender is public.** alphaXiv exposes a REST API at
`https://api.alphaxiv.org` (the same one its web app + the community `alphaxiv-py`
SDK use). I verified the key endpoints live during planning.

## Verified endpoints (live, no auth required)
- **Similar papers (the recommender):**
  `GET /papers/v3/{arxivId}/similar-papers` → **200, no API key.** For
  `1706.03762` it returned **92 ranked cards**. Each card already maps onto our
  model:
  - `universal_paper_id` = the **arXiv id** (→ readable in our reader via the
    existing PDF pipeline)
  - `title`, `abstract`, `paper_summary` (an AI summary, like HF's `ai_summary`),
    `authors` / `full_authors`, `topics` (→ tags), `metrics`, `publication_date`,
    `github_url`/`github_stars`.
- **Trending / discovery feed:**
  `GET /papers/v3/feed?pageNum=0&pageSize=N&sort=Hot` (public; `sort` ∈
  `Hot|Comments|Views|Likes|GitHub|…`).
- **Search:** `GET /v2/search` (+ `/v1/search/paper`, `/v1/search/closest-topic`).
- **Free AI overview:** `GET /papers/v3/{id}/overview/{lang}`.
- **Auth (optional, only for personalized/account features):** bearer
  `ALPHAXIV_API_KEY` (created in the alphaXiv web app). Not needed for
  similar-papers / trending.

> Note: alphaXiv's *documented* surface is an MCP server (`api.alphaxiv.org/mcp/v1`,
> OAuth) with `embedding_similarity_search` etc. The REST endpoints above are
> undocumented (used by their web app + community SDK), so treat them as
> best-effort and cache responses.

## How it maps to Marginalia
The similar-papers card ≈ our `DiscoverHit`, so most of this reuses the existing
Discover/`hitToPaper` plumbing (exactly like the Hugging Face integration):
`arxiv = universal_paper_id`, `tldr = paper_summary`, `keywords = topics`,
authors from `full_authors`, year from `publication_date`.

---

## Phases

### Phase 1 — alphaXiv as a Discover source
Add an `alphaxiv` adapter to `src/lib/discover.ts` (mirrors the HF adapter):
- **Search:** `/v2/search`. **Trending:** `/papers/v3/feed?sort=Hot`.
- Map → `DiscoverHit` (`source:"alphaxiv"`), add an "alphaXiv" source chip and a
  "Trending on alphaXiv" button. RRF-merges/dedupes with OpenAlex/arXiv/HF.
- Vite `/alphaxiv` dev proxy; native fetches directly (as with HF).

### Phase 2 — "Similar papers" recommender on a paper *(the headline feature)*
- In the **reader** and the **Library detail panel**, add a **Recommended**
  section that calls `/papers/v3/{cur.arxiv}/similar-papers` and renders the
  cards (reusing the Discover card: TL;DR, topics, **+ Add**, open).
- This upgrades today's "🔎 Find related" (which just re-runs a title search)
  into a real content-based recommender. Only shown when the paper has an arXiv
  id.

### Phase 3 — "Recommended for your library" feed
- Aggregate `similar-papers` across your recent/top papers, **dedupe against what
  you already have**, and rank by how often each recommendation recurs → a
  personalized-feeling feed **without any login**.
- Surface on the Dashboard ("Recommended for you") and/or a Discover "For You"
  tab. Cache + cap calls (e.g. top 10 seed papers) to stay light.

### Phase 4 — Optional extras
- **API key in Settings** (`ALPHAXIV_API_KEY`) to unlock alphaXiv's *personalized*
  feed/folders for users who have an account.
- **alphaXiv AI overview** (`/overview/{lang}`) as a free summary source on import
  (like HF's `ai_summary`) — pre-fills `summary`, `topics` → tags.

---

## Caveats
- **Undocumented REST API** → may change without notice; isolate it behind the
  adapter and fail soft (the recommender section just hides on error).
- **Rate limits unknown** → cache similar-papers per paper; cap Phase-3 fan-out.
- **CORS for web dev** unverified → use the `/alphaxiv` Vite proxy; native is fine.
- **Personalization** needs an account/API key; Phases 1–3 use only public,
  content-based recommendations.

**Recommended start:** Phase 1 + 2 — a few hours, reuses the HF/Discover pattern,
and delivers the "recommended papers" experience directly on each paper.
