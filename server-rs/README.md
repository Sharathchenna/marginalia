# Marginalia data + sync server (Rust / Axum)

The single-user, self-hosted **data tier** for the native iOS app (and any future
`RemoteRepository` web build). It re-targets the desktop app's Tauri commands to
HTTP routes, **reusing the exact same `db` / `metadata` / `embeddings` logic** —
see `core/src/lib.rs`, which `#[path]`-includes `../../../src-tauri/src/*.rs` so
there is one source of truth and the SQLite logic can't drift.

This is the sync hub + PDF object store described in
`docs/NATIVE-IOS-SERVER-PLAN.md`. It complements the **AI relay** (`server/server.mjs`,
already deployed) — that handles `POST /v1/agent`; this handles everything else.

## Run (local)
```bash
cd server-rs
MARG_TOKEN=your-shared-secret cargo run -p marginalia-server
# → listening on :8800, ./data/library.db, ./data/pdfs/
```

## Env
| var | default | purpose |
|---|---|---|
| `PORT` | `8800` | listen port (AI relay uses 8799) |
| `MARG_TOKEN` | (none) | require `Authorization: Bearer <token>` on `/v1/*` — **set this** |
| `MARG_DB` | `./data/library.db` | SQLite path (papers + FTS5 + kv + embeddings) |
| `MARG_PDF_DIR` | `./data/pdfs` | PDF object store directory |
| `MARG_CORS_ORIGIN` | `*` | allowed CORS origin |
| `AGENT_SCRIPT` | (unset) | path to `sidecar/agent.mjs` to enable `POST /v1/agent` (else 501) |

The Voyage embedding key + model are read from the stored **settings** KV
(`voyageKey` / `embedModel`), exactly like the desktop app — `PUT /v1/settings`
to set them.

## Routes (all under `/v1`, bearer-auth'd)
| Method + path | Reuses | Notes |
|---|---|---|
| `GET /papers` `?since=<ts>` | `db::list_papers` | omit `since` = full pull; else per-record LWW (updatedTs/addedTs) |
| `GET/PUT/DELETE /papers/:id`, `POST /papers` | `db::get/update/delete/upsert_paper` | |
| `POST /papers/replace` | `db::replace_papers` | whole-snapshot sync |
| `GET /search?q=` | `db::search` | FTS5 prefix |
| `GET/PUT /collections`, `/feeds`, `/settings` | `db::get_kv/set_kv` | settings PUT merges |
| `GET /lookup?id=` | `metadata::lookup` | DOI / arXiv / URL |
| `GET /retraction?doi=` | `metadata::check_retraction` | Retraction Watch (only the DOI is sent) |
| `GET /webpage?url=` | `metadata::fetch_webpage` | resolve a web page → saveable item |
| `GET /feed?url=&etag=&since=` | `metadata::fetch_feed` | user RSS/Atom subscription (conditional GET). Distinct from `/feed/latest` (curated HF daily papers) |
| `POST /embed`, `GET /embed/status`, `/semantic?q=&k=`, `/similar/:id?k=` | `embeddings::*` + `db::*` | Voyage |
| `GET/PUT /pdf/:id`, `GET /pdf` | disk object store | `:id` → `<id>.pdf` (sanitized) |
| `POST /pdf/:id/fetch` `{url}` | disk object store | server-side download of a PDF URL into the store (mirrors desktop `download_pdf`) |
| `POST /agent` (SSE) | spawns `node agent.mjs` | ports `server.mjs`; gated on `AGENT_SCRIPT` (off here; the AI relay handles agent) |
| `GET /health` (no auth) | — | `{"ok":true}` |

## Deploy
Build the static-ish binary and run behind the same private HTTPS as the AI relay
(Tailscale serve / Caddy). A `Dockerfile` is provided (multi-stage; build context
must be the **repo root** so the `#[path]` includes resolve):
```bash
docker build -f server-rs/Dockerfile -t marginalia-data .
docker run -e MARG_TOKEN=secret -v marg-data:/data -p 127.0.0.1:8800:8800 marginalia-data
```
Back up `library.db` + the `pdfs/` dir (the plan flags both as load-bearing).

## Companion Node service (`../server`)
The Node-side features that can't run in Rust live in the AI relay (`server/server.mjs`,
the `marginalia-ai` container) so iOS/web get full parity:
- `POST /v1/cite` `{paper|papers, style}` + `GET /v1/cite/styles` — citeproc/CSL
  (IEEE, Nature, ACM, AMA, Harvard…) with the dependency-free APA/MLA/Chicago/BibTeX
  fallback; ports `citation.ts`/`csl.ts` (`server/cite.mjs`).
- `POST /v1/tts/speak` + `GET /v1/tts/voices` — Microsoft Edge neural read-aloud
  (spawns `sidecar/tts.mjs`).

## What's NOT here yet (future)
- Auth is a single shared token (single-user). No multi-user/ACL.
