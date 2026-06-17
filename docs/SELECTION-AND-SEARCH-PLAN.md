# Plan — Selection-as-context for the agent + more search engines

Two requests, grounded in the current code.

---

## Part A — Pass the selected text to the agent as context (with the full PDF)

### Where we are
- The reader's selection popover has **✨ Ask AI**, which today calls
  `store.openChatWith(seed)` — it just **prefills the chat input** with the
  passage as plain text.
- When you then send, `chatAboutPaper(paper, question, history, handlers, pdfPath)`
  already passes `pdfPath`, so the sidecar **can Read the full PDF**
  (`allowedTools: ["Read"]`).
- **Gap:** the selection is dumped into the question box as text; it isn't a
  distinct, persistent "focus" the agent is told to ground on, and it disappears
  after one message.

### What to build — a pinned "context chip"
Make the selection a first-class context that rides along with every message in
that chat, *plus* the full PDF.

1. **Store** (`src/store.ts`)
   - Add `chatSelection: string` state (the passage).
   - Popover ✨ → new `openChatAboutSelection(text)`: sets `chatScope="paper"`,
     `chatSelection=text`, opens chat, leaves the input **empty** (you type the
     question; the passage is the context, not the question).
   - `openChat()` / closing the chip clears `chatSelection`.

2. **ChatPanel** (`src/components/ChatPanel.tsx`)
   - Render a **context chip** at the top when `chatSelection` is set:
     `Focused on: "…first 120 chars…"` with an `×` to clear.
   - Pass `selection` on every `chatAboutPaper(...)` call while the chip is
     present (so follow-up questions stay grounded on the passage).

3. **Agent client** (`src/lib/agent.ts`)
   - `chatAboutPaper(..., pdfPath?, selection?)` → include `selection` in the
     payload.

4. **Sidecar** (`src-tauri/sidecar/agent.mjs`, chat mode)
   - When `payload.selection` is present, prepend a section to the system prompt:
     ```
     === FOCUS PASSAGE (the user selected this in the PDF) ===
     "<selection>"
     Ground your answer in this passage. Use the Read tool on the full PDF at
     <pdfPath> for surrounding context (definitions, the section it's in,
     equations it references) when needed.
     ```
   - Keep `allowedTools: ["Read"]` + `cwd` so the model still has the whole PDF.

**Result:** select a dense sentence → ✨ → ask "what does this mean?" → the agent
answers about *that passage*, having read the surrounding PDF, and the passage
stays pinned for follow-ups. Small change (~4 files), high value.

> Optional extra: a **"Highlight + Ask"** combo, and showing the focus passage as
> a quoted block in the first assistant turn for clarity.

---

## Part B — Add more search engines to Discover

### Where we are
`Discover` uses **OpenAlex only** (`src/lib/discover.ts`, `searchWorks` +
`relatedWorks`, `/openalex` Vite proxy; direct in native). One source, one ranking.

### What to build — a federated, multi-source Discover
Adopt the adapter pattern from `docs/SEARCH-ENGINE-PLAN.md`.

1. **Adapter interface** (`src/lib/discover/` folder)
   ```ts
   interface SearchAdapter {
     id: "openalex" | "semanticscholar" | "arxiv" | "crossref";
     label: string;
     search(query: string): Promise<DiscoverHit[]>;
   }
   ```
   `DiscoverHit` gains `source` and optional `tldr`, `arxiv`.

2. **Adapters**
   | Source | Why add it | Notes |
   |---|---|---|
   | **OpenAlex** | already in; broad metadata + citations | keep as default |
   | **Semantic Scholar** | **TLDR one-line summaries**, citation counts, influential-citation graph | CORS-OK; optional free API key for higher limits |
   | **arXiv** | preprints **with a real PDF** → discovered papers become **readable immediately** (sets `arxiv`, reader opens it) | reuse `/arxiv-api` proxy + Atom parse |
   | **Crossref** | authoritative DOIs / published versions | reuse `/crossref` proxy |
   | *(later)* PubMed/DBLP | domain coverage (bio / CS) | opt-in |

3. **Proxies & native** — add `/semanticscholar` Vite proxy (arXiv/Crossref/OpenAlex
   proxies already exist). Native fetches directly (S2/OpenAlex/Crossref allow CORS;
   arXiv has none → route native arXiv through a tiny Rust `http_get` command, or
   just use OpenAlex/S2 natively and gate arXiv to web — decide at build).

4. **Federation + ranking**
   - **Source chips** in the Discover UI: `OpenAlex · Semantic Scholar · arXiv ·
     Crossref` (multi-select; default all-on).
   - Query selected sources **in parallel**, normalize, **de-dupe** by
     `DOI → arXiv → normalized title`, merge identical hits (record which sources
     matched — a cross-source hit ranks higher).
   - Merge with **Reciprocal Rank Fusion** (simple, robust) + light boosts
     (citation count, exact-title match).
   - Show a **source badge** + **citation count** + **TLDR** (when from S2) on each
     result; "+ Add" unchanged (arXiv hits set `arxiv` so they're readable).

5. **Etiquette/caching** — `mailto` polite pool for OpenAlex/Crossref; cache
   results per `(source, query)` in memory; debounce; handle 429 with a notice.

### Phases
1. **Multi-source search** — adapter interface + arXiv + Crossref + Semantic
   Scholar adapters, source chips, parallel fetch, DOI/arXiv/title dedup, RRF merge,
   source badges. *(Biggest value; arXiv makes discovered papers instantly
   readable.)*
2. **Richer cards** — TLDR from S2, citation counts, "References / Cited by" links.
3. **Citation graph** — pull references/citations (S2 or OpenAlex) into the
   Connections graph; snowball discovery.

---

## Recommended order
1. **Part A** (selection-as-context) — small, immediately useful while reading.
2. **Part B Phase 1** (multi-source Discover with arXiv) — turns Discover into a
   real, federated search and makes found papers openable on the spot.
3. Part B Phases 2–3 as follow-ups.
