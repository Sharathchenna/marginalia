# Plan — Claude AI in Marginalia

Goal: use Claude to do the reading work — starting with the thing that's broken
right now (scanned PDFs have no authors/tags/abstract), then summaries, tagging,
and "chat with your papers."

> **"Claude Code SDK" → Claude Agent SDK.** The Claude Code SDK was renamed the
> **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`).
> It's for *autonomous, multi-step agents* (Node/Python). For Marginalia's
> in-app features, the better fit is the **Anthropic Messages API called from
> Rust** — it accepts PDFs directly, returns schema-validated JSON, supports
> prompt caching and streaming, and keeps the API key out of the webview.
> Recommendation: **Messages API now; Agent SDK later** only if we want a
> hands-off "research agent" (see §6).

---

## 0. The immediate win — AI metadata extraction (fixes authors/tags)

Right now `scan_pdfs` only knows the filename, so authors/venue/year/abstract/tags
are empty. Claude reads PDFs natively, so:

1. On import/scan (or a per-paper "✨ Extract" button), read the first ~2 pages
   of the PDF, send them to Claude with a **structured-output schema**, and get
   back `{title, authors, authorsFull, year, venue, doi, arxiv, abstract, tags}`.
2. Merge into the paper record (`patchPaper`) → authors, venue, year, abstract,
   and AI-suggested tags now populate.

This is one Rust command + one schema, and it's the highest-value feature.

```jsonc
// output_config.format → guarantees parseable JSON (Opus 4.8 / Sonnet 4.6 / Haiku 4.5)
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["title","authorsShort","authorsFull","year","venue","doi","arxiv","abstract","tags"],
    "properties": {
      "title":       {"type":"string"},
      "authorsShort":{"type":"string"},          // "Vaswani et al."
      "authorsFull": {"type":"string"},
      "year":        {"type":"integer"},
      "venue":       {"type":"string"},
      "doi":         {"type":"string"},
      "arxiv":       {"type":"string"},
      "abstract":    {"type":"string"},
      "tags":        {"type":"array","items":{"type":"string"}}
    }
  }
}
```

Send the PDF as a `document` block (base64) in the user message; force the schema
via `output_config.format`. Use **`claude-haiku-4-5`** here — extraction is simple
and high-volume, and Haiku is the cheapest ($1/$5 per 1M tokens).

---

## 1. Feature set

| Feature | What Claude does | Model | Notes |
|---|---|---|---|
| **Metadata extraction** (§0) | PDF → {authors, venue, year, DOI, abstract, tags} | Haiku 4.5 | structured output; batch on scan |
| **Auto-tagging** | Suggest 3–6 topical tags from abstract/library taxonomy | Haiku 4.5 | reuse existing tags as a controlled vocab |
| **Summary / TLDR** | 2–3 sentence plain-language summary + key contributions | Sonnet 4.6 | shown in detail panel & notebook |
| **Ask this paper** | Q&A grounded in the full PDF, with citations to pages | Opus 4.8 | streaming; prompt-cache the PDF |
| **Ask your library** | Answer across many papers (which papers address X?) | Opus 4.8 | retrieve candidates by search, then synthesize |
| **Smart notes** | Turn highlights into a structured summary in the Notebook | Sonnet 4.6 | |
| **Find related** | "More like this" from the abstract | Sonnet 4.6 | pairs with the search-engine plan's embeddings |

---

## 2. Architecture — call Claude from Rust

```
React UI ──invoke──> Rust commands (ai.rs) ──reqwest──> api.anthropic.com/v1/messages
   │                      │
   │                      ├─ API key from OS keychain (never in the webview)
   │                      ├─ PDF bytes read locally → base64 document block
   │                      └─ streaming (SSE) for chat → emit tokens to the UI
```

- **Why Rust, not the webview:** the Anthropic API has no CORS for browser use and
  the key must not ship in frontend code. Rust (`reqwest`) already powers metadata
  download — add `ai.rs` next to it.
- **Key storage:** OS keychain via `keyring` crate (or `tauri-plugin-stronghold`).
  A Settings field lets the user paste their key once; stored encrypted, never
  rendered back.
- **Commands:** `ai_extract_metadata(file)`, `ai_summarize(paperId)`,
  `ai_tags(paperId)`, `ai_ask(paperId, question)` (streaming),
  `ai_ask_library(question, candidateIds)`.
- **PDF input:** read the local file from the library folder → base64 → `document`
  block. For papers > ~30 pages, send first N pages or upload once via the **Files
  API** and reference by `file_id` across questions.
- **Structured output:** `output_config.format` (json_schema) for extraction/tags —
  no brittle parsing.
- **Prompt caching:** for "Ask this paper", cache the document block
  (`cache_control: {type:"ephemeral"}`) so follow-up questions are ~10% the cost.
- **Streaming:** chat uses SSE; Rust forwards tokens to the webview via a Tauri
  event so answers render live. Default `max_tokens` 16k (non-stream) / 64k (stream).
- **Adaptive thinking:** `thinking: {type:"adaptive"}` on Opus 4.8 for the harder
  "ask library" synthesis; omit for cheap extraction.

### Model choice (current IDs)
- `claude-haiku-4-5` — extraction, tagging (cheap, fast)
- `claude-sonnet-4-6` — summaries, related, smart notes (balanced)
- `claude-opus-4-8` — chat / cross-library reasoning (most capable; default)

---

## 3. UX touchpoints
- Detail panel: **✨ Extract metadata**, **Summarize**, **Suggest tags** buttons;
  a "Summary" section; an **Ask** box.
- Import/scan: a toggle "Extract metadata with AI on import" (off by default →
  user controls cost); a per-row ✨ for on-demand.
- A small **AI settings** block: API key field, default model, "auto-extract on
  import" toggle, monthly spend estimate.

## 4. Cost & privacy
- **Local-first caveat:** AI features send PDF text/pages to Anthropic's API —
  make that explicit and keep them **opt-in** (off until the user adds a key and
  enables them). Everything else stays on device.
- Cost control: Haiku for bulk extraction; cache documents for chat; show a
  running token/cost estimate (the API returns `usage`).
- Batch extraction can use the **Batches API** (50% cheaper) for "extract all".

## 5. Phasing
1. **Metadata extraction** (§0) — `ai.rs` + `ai_extract_metadata` + key storage +
   detail-panel button + "auto on import" toggle. *Fixes the authors/tags gap.*
2. **Summary + auto-tags** — two more commands, shown in detail panel & notebook.
3. **Ask this paper** — streaming chat grounded in the PDF, page citations,
   document prompt-caching.
4. **Ask your library** — search to shortlist papers, synthesize an answer with
   citations (ties into `docs/SEARCH-ENGINE-PLAN.md`).
5. **Batch + polish** — Batches API for "extract all", spend meter, retries/backoff.

## 6. When to reach for the Claude Agent SDK instead
If you want a hands-off **research agent** — "find papers on X, add the best 10,
extract metadata, tag them, and write me a lit-review" — that's an autonomous
multi-step loop, which is what the **Claude Agent SDK** (the renamed Claude Code
SDK) is built for. It runs as a Node/Python **sidecar** the Tauri app talks to
(heavier to bundle than direct API calls). Recommendation: ship Phases 1–4 on the
Messages API first; add an Agent SDK sidecar only when we want true autonomy.

## Recommended first step
Build **Phase 1**: a Rust `ai_extract_metadata` command (Haiku 4.5 + PDF document
block + the §0 schema), a keychain-backed API-key setting, and a **✨ Extract**
button in the detail panel. That alone turns every scanned "filename-only" paper
into a real record with authors, venue, year, abstract, and tags.
