# Marginalia — native iOS client + self-hosted server (plan)

**Decision (2026-06-25):** ship a **native SwiftUI iOS app** backed by a
**single-user, self-hosted server** with an **on-device offline cache**. This
keeps the local-first soul (your own box; works offline) while giving a real
native app — and it sidesteps the Tauri/`swift-rs`/Xcode-27 build blocker
entirely (no Tauri on iOS).

This is the high-effort path (a second UI in Swift). It is feasible because the
data/logic tier is already cleanly separated and mostly already written.

---

## Why this is feasible (the reuse leverage)

The codebase is unusually well-positioned. The seams already exist:

| Asset (today) | Role in the new architecture | Work |
|---|---|---|
| `Repository` interface (`src/lib/repo.ts`) | 12-method data contract; proves the data layer is swappable | reference |
| `src-tauri/src/db.rs` | SQLite (JSON blobs + FTS5 + KV + embeddings) | **reuse verbatim** on the server |
| `src-tauri/src/metadata.rs` | DOI/arXiv lookup, retraction, webpage/feed fetch | **reuse verbatim** |
| `src-tauri/src/embeddings.rs` | Voyage embed + cosine | **reuse verbatim** |
| `src-tauri/src/lib.rs` commands | thin `#[tauri::command]` wrappers over `db::`/`metadata::` | **re-target** to HTTP (≈1:1) |
| `server/server.mjs` | AI relay (HTTP/SSE → `agent.mjs` sidecar) | **already done** |
| `src/lib/citation.ts` + `csl.ts` | CSL/citeproc formatting | expose as a server endpoint (don't reimplement in Swift) |
| `src/types.ts` | data model | port to Swift `Codable` structs |
| React components + `store.ts` | the UI | **reimplement in SwiftUI** ← the real cost |
| pdf.js reader | PDF view + highlights | **replace with PDFKit** (a native win) |

Key insight: the Tauri command layer is a thin shim. e.g. `list_papers` is
`db::list_papers(&conn)`; `lookup_identifier` is `metadata::lookup(&id)`.
Swapping `#[tauri::command] + State<AppState>` for an Axum handler + a shared
`Connection` is mechanical. **The server is ~80% written.**

---

## Architecture

```
┌─ iPhone (native SwiftUI app) ──────────────┐        ┌─ Self-hosted server (yours) ─┐
│  SwiftUI views                              │  HTTPS │  Axum (Rust)                  │
│  GRDB (SQLite) local cache  ◀── sync ──▶    │ ◀────▶ │   ├ db.rs   (library.db)      │
│  PDFKit reader (annotations)                │ Bearer │   ├ metadata.rs (fetchers)    │
│  Keychain (server URL + token)              │ token  │   ├ embeddings.rs (Voyage)    │
│  Share Extension → capture                  │        │   ├ /pdf object store (disk)  │
└─────────────────────────────────────────────┘        │   └ AI relay (agent.mjs)      │
                                                        └───────────────────────────────┘
```

- **Auth:** one shared bearer token (reuse the `MARG_TOKEN` pattern from
  `server.mjs`). Stored in the iOS Keychain. HTTPS is mandatory — terminate with
  Caddy/Let's Encrypt, a Cloudflare Tunnel, or Tailscale (no public exposure).
- **Offline-first:** the local GRDB store is the read source of truth. Mutations
  apply locally first, queue, and push. Pull on launch/foreground.
- **Sync model (start simple):** per-record last-writer-wins keyed on a
  `updatedTs` field, pulled via `GET /v1/papers?since=<ts>`. Whole-snapshot LWW
  (the existing desktop sync) also works and is less code, but churns the whole
  library on every phone edit — prefer per-record once more than one device edits.

---

## Server (≈3–5 days)

Recommended: **one Rust/Axum binary** that reuses the existing modules.

1. **Carve the logic into a shared crate.** Move `db.rs`, `metadata.rs`,
   `embeddings.rs` into a `marginalia-core` lib crate (or a `[lib]` target the
   Tauri app and the server both depend on). They have no Tauri imports today, so
   this is a move + `pub` audit.
2. **Axum service** (`server/` as a Rust bin, or a new `server-rs/`):
   - Shared `Connection` behind a `Mutex`/pool (same as `AppState` does now).
   - Bearer-token middleware (reuse `MARG_TOKEN`).
   - Re-target each command to a route — roughly 1:1 with `generate_handler!`:

   | Route | Reuses |
   |---|---|
   | `GET/PUT/POST/DELETE /v1/papers[...]`, `GET /v1/search` | `db::*` |
   | `GET/PUT /v1/collections`, `/v1/feeds`, `/v1/settings` | `db::get_kv/set_kv` |
   | `GET /v1/lookup`, `/v1/retraction`, `/v1/webpage`, `/v1/feed` | `metadata::*` |
   | `POST /v1/embed`, `GET /v1/semantic`, `/v1/similar`, `/v1/embed/status` | `embeddings::*` + `db::*` |
   | `GET/PUT /v1/pdf/{id}` | new: disk object store |
   | `POST /v1/cite` | new: tiny node fn reusing `citation.ts`/`csl.ts` |
   | `POST /v1/agent` (SSE) | keep `server.mjs`, or port its 50-line relay |
3. **PDF object store (≈1–2 days):** `PUT /v1/pdf/{id}` (auth'd upload),
   `GET /v1/pdf/{id}` (download/stream). Back it with a `pdfs/` dir. Replaces
   `read_pdf`/`download_pdf`/`import_pdf`/`scan_pdfs`. Client downloads lazily and
   caches; support a "metadata-only" sync so the phone isn't forced to pull GBs.
4. **Drop on the server:** `capture_port`, `start_watch` (desktop-only),
   `open_url`, `webdav_*` (the server *is* the sync hub now).
5. **Dockerize** (a `Dockerfile` already exists for the AI server) and put it
   behind HTTPS.

> Lower-skill alternative: extend `server.mjs` (Node + `better-sqlite3`) instead
> of Axum. Costs a port of `db.rs`'s ~240 lines of SQL to JS and risks the desktop
> and server SQLite logic diverging. The Rust path avoids that by literal reuse.

---

## Native iOS app (the bulk — ≈5–9 weeks for full parity)

Stack: **SwiftUI**, **GRDB.swift** (SQLite cache + FTS), **PDFKit** (reader),
`URLSession`/async-await networking, Keychain for the token. Target **iOS 16+**.

**Foundations (≈1 week)**
- `Models/` — port `types.ts` to `Codable` structs (`Paper`, `Collection`,
  `Feed`, `Settings`, `Highlight`, `Retraction`). ~1:1.
- `Store/` — GRDB schema mirroring `db.rs` (papers JSON + FTS5, kv, embeddings).
- `API/` — a `MarginaliaAPI` actor mirroring the routes above; token from Keychain.
- `Sync/` — pull-on-foreground, push-on-change, LWW; offline mutation queue.

**Core screens (≈2 weeks) — MVP cut**
1. Library list (filters, collections sidebar, search) — `List`/table + card mode.
2. **Reader (PDFKit):** native PDF, text selection → highlights stored as
   `Highlight[]` (reuse the model); resume on `lastPage`. Native PDFKit is a clear
   upgrade over the pdf.js webview path.
3. Item detail / metadata edit.
4. Add / capture: paste DOI/arXiv/URL → `GET /v1/lookup`; save to library.
5. Settings: server URL + token, theme, density.

**AI (≈2–3 days)** — chat over `POST /v1/agent` (SSE) via `URLSession.bytes`.
Reuse the existing event protocol (`delta`/`thinking`/`tool`/`done`/`error`).

**Secondary screens (≈1–2 weeks)** — Dashboard, Feeds (reader), Flashcards +
Review (the SRS state is already on `Paper.cards`), Discover.

**Capture (≈2–3 days)** — a **Share Extension**: "Share → Marginalia" posts the
URL to `POST /v1/webpage` (or queues locally to sync). `ios/share-extension/`
has a reference already.

---

## The two hard parts (plan around them, don't reimplement)

1. **Citations / CSL.** `citation.ts` + `csl.ts` use `citeproc` (JS). Do **not**
   port CSL to Swift. Either (a) a server `POST /v1/cite` that runs the existing
   JS, and the app caches results for offline; or (b) run the JS in
   `JavaScriptCore` on-device. Recommend (a) — less code, offline via cache.
2. **Graph view.** `GraphView.tsx` is d3-force. On mobile, **defer it** or embed
   just that one screen in a `WKWebView` loading the existing React graph. A
   native SwiftUI Canvas force-sim is possible but not MVP-worthy.

---

## Phased roadmap

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | Carve `marginalia-core` crate; decide HTTPS ingress (Tunnel/Tailscale/Caddy) | 1–2 d |
| 1 | Axum server: CRUD + metadata + embeddings routes + token auth | 3–4 d |
| 2 | PDF object store + `/v1/cite` + keep AI relay | 2–3 d |
| 3 | iOS scaffold: models, GRDB cache, API client, Keychain, sync engine | ~1 wk |
| 4 | **MVP**: Library + Reader(PDFKit) + Add + Settings + AI chat | ~2.5 wk |
| 5 | Secondary screens (Dashboard, Feeds, Flashcards/Review, Discover) | 1–2 wk |
| 6 | Share Extension capture; offline hardening; library import/migration | ~1 wk |
| 7 | Graph (defer or webview); polish; sideload/TestFlight | ~1 wk |

**Usable MVP (Library + Reader + Add + AI + sync): ~3–4 weeks.**
**Full feature parity: ~6–10 weeks.**

---

## Risks & the long-term cost

- **Two UIs forever.** Every feature now ships twice (React desktop/web + SwiftUI
  iOS). This is the real ongoing tax of going native — budget for it. (The PWA
  path avoided this; you chose native deliberately.)
- **Offline conflicts.** LWW can clobber a concurrent desktop edit. Acceptable for
  a single-user, read-mostly companion (documented limitation today). Per-record
  `updatedTs` sync reduces the blast radius vs whole-snapshot.
- **PDF bandwidth/size.** Lazy download + cache + metadata-only sync; never force a
  full-library pull on cellular.
- **Server is now load-bearing.** It must be up, backed up, and HTTPS-fronted.
  Keep nightly backups of `library.db` + `pdfs/`.
- **Citation engine** is the one piece with no clean Swift story — keep it on the
  server.

---

## What does NOT change

The desktop/web app is untouched: the whole React tree, `store.ts`, and most of
`src/lib` (citations, CSL, dedupe, pdf, markdown, search) keep running as-is. The
server simply becomes a third `Repository` backend the existing app could also use
later (a `RemoteRepository`), if you ever want the web build to point at it too.
