# Plan — Get papers from Hugging Face

Some papers surface on **HF Papers** (and some "papers" are really HF **model/
dataset cards**). This plan brings both into the library. Grounded in the live
HF API (all endpoints below returned 200 during probing).

## Key finding (shapes the whole approach)
- **HF Papers are arXiv-backed.** `GET https://huggingface.co/api/daily_papers`
  and `…/api/papers/<arxivId>` return a `paper` object with:
  `id` (= the **arXiv id**), `title`, `summary`, `authors[].name`, `upvotes`,
  **`ai_summary`**, **`ai_keywords`**. So fetching an HF paper = great metadata +
  a free AI summary/keywords, and the **PDF reuses the existing arXiv download**
  (so it's immediately readable in the reader).
- **Truly HF-only items are model/dataset cards** (a README, not a PDF). These
  usually carry an `arxiv:<id>` tag (confirmed: `meta-llama/Llama-3.1-8B` →
  `arxiv:2204.05149`) that points at the real paper.

---

## Part 1 — Hugging Face as a Discover source (adapter)
Add a `huggingface` adapter to `src/lib/discover.ts`, alongside OpenAlex/S2/arXiv/
Crossref.
- **Search:** `https://huggingface.co/api/papers/search?q=<query>` (200 ✓).
- **Trending (empty query):** `https://huggingface.co/api/daily_papers?limit=30`.
- **Map → `DiscoverHit`:** `source: "huggingface"`, `arxiv = paper.id`,
  `abstract = summary`, `tldr = ai_summary`, `citedBy = upvotes` (popularity proxy),
  authors from `authors[].name`; stash `ai_keywords` for tag pre-fill.
- Because `arxiv` is set, `hitToPaper` makes HF results **readable in the reader**
  immediately (existing arXiv PDF flow) and the merge/RRF de-dupes them against
  OpenAlex/arXiv hits for the same paper.
- **UI:** add a "Hugging Face" source chip; show upvotes + an "HF" badge.
- **Net/CORS:** HF API is public + CORS-enabled. Add a `/huggingface` Vite proxy
  for web dev; native fetches directly.

## Part 2 — Add-by-ID accepts Hugging Face URLs
Extend `classifyIdentifier` (`src/lib/metadata.ts`):
- `huggingface.co/papers/<arxivId>` → treat as the arXiv id → existing arXiv
  lookup + PDF.
- `huggingface.co/<org>/<model>` or `…/datasets/<id>` → a new `hf` kind →
  `lookupHuggingFace(id)`:
  - `GET /api/models/<id>` (or `/api/datasets/<id>`); if `tags` contains
    `arxiv:<id>` → resolve to **that arXiv paper** (best outcome: real paper + PDF).
  - else import the **card** (Part 3).
- Add a HF URL to the Add-by-ID examples.

## Part 3 — Model/dataset cards as papers (the "only on HF" case)
For HF items with no arXiv paper:
- Fetch the README: `https://huggingface.co/<id>/raw/main/README.md`, strip YAML
  frontmatter, store as `abstract`/`summary` (and `notes`); `venue = "Hugging Face"`,
  `doi/arxiv = "—"`, keep the HF URL.
- **Reader markdown fallback:** when a paper has no PDF (no `arxiv`, no local
  `file`) but has card/summary content, render it as **Markdown** (reuse
  `react-markdown`) instead of the bundled sample PDF. Small, self-contained
  reader addition; also benefits any future non-PDF item.

## Part 4 — Free wins from HF
- `ai_summary` → pre-fill the paper's **summary** on import (no Claude call).
- `ai_keywords` → seed **tags** on import (then Auto-tag can refine, reusing them).
- These make HF imports arrive already-summarised and tagged.

## Part 5 — Discover UX
- Empty search box → show **"Trending on Hugging Face"** (daily_papers).
- HF source chip; per-result HF badge + upvote count; PDF badge (arXiv-backed).

---

## Phases
1. **HF Discover adapter** (search + trending) + chip + arXiv-backed readability +
   `ai_summary`/`ai_keywords` pre-fill. *Biggest value; reuses the existing PDF
   pipeline; mostly one adapter + one proxy.*
2. **Add-by-ID HF URLs** — papers URLs and model/dataset cards that have an
   `arxiv:` tag.
3. **README import + Markdown reader fallback** for genuinely PDF-less HF items.

**Recommended:** start with Phase 1 — it covers the common case ("this paper is on
HF Papers") with the least work and makes those papers fully readable.
