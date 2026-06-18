# Plan — Voyage embeddings (semantic search) for Marginalia

Add semantic retrieval on top of the existing lexical search, using **Voyage AI**
embeddings. Hybrid (lexical + vector) so we keep instant/offline exact-match and
gain meaning-based recall. Powers: better "Ask your library", a search toggle,
and a "Similar papers" feature.

> Privacy note: embedding sends each paper's title/abstract/concepts (and
> optionally truncated body text) to Voyage. This is **opt-in** — nothing is sent
> until the user adds a key and builds the index. Default off; lexical search is
> unchanged when no key is set.

## Why Voyage
- Anthropic's recommended embedding partner; strong retrieval quality.
- Generous free tier (~200M tokens) — far beyond any personal library
  (a full-text paper ≈ 10–15k tokens, so even 1,000 papers ≈ ~1% of a much
  smaller budget). Embedding is one-time per paper (cached by content hash).

## API shape (verify exact limits at build time)
- `POST https://api.voyageai.com/v1/embeddings`
- Header: `Authorization: Bearer <VOYAGE_API_KEY>`
- Body: `{ "input": [..texts..], "model": "voyage-3.5-lite", "input_type": "document" | "query", "output_dimension": 1024 }`
- Response: `{ "data": [{ "embedding": number[], "index": n }], "usage": { "total_tokens": n } }`
- Batch documents (≈128 inputs/request, respect per-request token cap); embed
  queries with `input_type:"query"`.

---

## Architecture

**Embeddings live in Rust** (reqwest), not the Claude sidecar: it's a plain HTTP
call, keeps the API key in the backend/SQLite (out of the webview), and lets us
do the cosine search server-side.

### Rust (`src-tauri`)
- **Settings:** add `embedProvider` ("voyage"|"off"), `embedModel`
  ("voyage-3.5-lite"), `voyageKey` (string). Stored in the existing settings KV.
  *(Plaintext in the local DB for now; a later pass can move it to the OS
  keychain.)*
- **New table** (`db.rs`): `embeddings(paper_id TEXT PRIMARY KEY, model TEXT,
  dim INT, hash TEXT, vec BLOB)` — `vec` = little-endian f32 bytes; `hash` =
  hash of the embedded text so unchanged papers are skipped on rebuild.
- **Commands** (`embeddings.rs`):
  - `voyage_embed(texts, input_type) -> Vec<Vec<f32>>` — batched HTTP call.
  - `embed_papers(items: [{id, text}]) -> {embedded, skipped}` — hash-check,
    embed the changed ones, upsert vectors. Used by "build index".
  - `semantic_search(query, k) -> [{id, score}]` — embed the query, cosine over
    stored vectors, return top-k. (Cosine in Rust over the table; for a few
    hundred papers this is sub-millisecond.)
  - `similar_papers(id, k) -> [{id, score}]` — cosine of one paper's vector vs
    the rest.
  - `embedding_status() -> {total, embedded, model}` — for the Settings UI.

### Frontend (`src`)
- **`lib/embeddings.ts`** — thin wrappers over the Rust commands; `buildText(p)`
  = `title + abstract + concepts (+ capped fulltext)`; no-ops (returns empty)
  when provider is off or not native.
- **Hybrid retrieval** — reuse the **RRF merge we already have** in `discover.ts`:
  fuse the lexical ranked list (`retrieveForChat`/`searchPapers`) with the
  semantic ranked list (`semantic_search`) into one. Lexical-only when no key.
- **Store** — `embed`/`buildIndex` action with progress toast; re-embed a paper
  on add / auto-tag / abstract edit (lazy: mark stale, embed on next build or
  search). Expose `embedStatus`, `setVoyageKey`, `setEmbedModel`.

### UI
- **Settings → new "Semantic search (embeddings)" section:** provider toggle,
  Voyage API-key field (password input), model dropdown, **"Build index"**
  button with `embedded/total` progress, and a one-line privacy note.
- **Library detail → "Similar papers":** top-5 nearest neighbours (click to
  open); complements the manual "Related".
- **Library chat** already calls retrieval → automatically hybrid once a key
  exists.
- **Search box:** add a subtle "semantic" indicator / blended results.
- **(Optional) Connections graph:** a toggle to draw edges from nearest
  neighbours instead of shared tags/concepts.

---

## Phases
1. **Rust core** — settings fields, `embeddings` table, `voyage_embed` +
   `embed_papers` + `semantic_search` + `embedding_status` commands.
2. **Frontend plumbing** — `lib/embeddings.ts`, store actions, RRF hybrid in
   `retrieveForChat`; Settings section (key, model, build index, status).
3. **Features** — "Similar papers" in the detail panel; hybrid in library chat
   + search box.
4. **Optional/polish** — semantic graph edges; auto re-embed on edits; move the
   key to the OS keychain.

**Recommended start:** Phase 1 + 2 (index can be built and used by chat/search),
then Phase 3 for the visible "Similar papers" feature.

## Cost & safety
- One-time embed per paper, cached by content hash → trivial token use.
- Opt-in: no key → feature hidden, lexical search unchanged.
- Batch requests; cap per-paper text; handle 401/429 gracefully (toast, keep
  lexical results).
