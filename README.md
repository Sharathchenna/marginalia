# Marginalia

A calm, reading-first research paper manager — a local alternative to
Mendeley/Zotero that is **also** a full-text bookmark manager and RSS blog
reader, with an AI "explainer" for every paper.

Marginalia is **native Swift apps** (macOS + iOS) backed by a **single-user,
self-hosted server**. Each app keeps a local cache for offline reading and
delta-syncs with the server; everything that needs a shared service (metadata
lookup, embeddings/semantic search, retraction checks, citations, read-aloud,
and the Claude-powered explainer/chat) is a thin call to the server.

> Earlier versions were a Tauri + React desktop/web app. That has been **retired**
> in favour of the native Swift apps; its shared Rust logic now lives in the
> server (`server-rs/core`). See the git history if you need it.

## Architecture

```
ios-native/            Native SwiftUI apps (one XcodeGen project, two targets)
  Sources/
    Models/            Codable domain types (Paper, Collection, Feed, Settings…)
    Common/            Shared, UI-free services (sync, lookup, PDF, citations,
                       TTS, semantic search, retraction, feeds, SRS, chat…)
    Data/              Local-cache repository (JSON) + delta sync
    App/AppModel.swift The shared @Observable state hub (used by both UIs)
    Features/          iOS / iPadOS SwiftUI screens
    macOS/             macOS-native SwiftUI screens (NavigationSplitView, Table,
                       PDFKit, menu commands)
  project.yml          XcodeGen spec → MarginaliaSpike (iOS) + MarginaliaMac (macOS)

server-rs/             Data + sync server — Rust / Axum  (container: marginalia-data)
  core/src/            db.rs (SQLite: JSON + FTS5 + KV + embeddings),
                       metadata.rs (DOI/arXiv lookup, retraction, webpage/feed),
                       embeddings.rs (Voyage embed + cosine)
  server/src/main.rs   HTTP routes: papers CRUD + /sync, search, collections/
                       settings/feeds, lookup/retraction/webpage/feed,
                       embed/semantic/similar, PDF object store, latest feed

server/                AI relay — Node  (container: marginalia-ai)
  server.mjs           HTTP/SSE: /v1/agent (Claude), /v1/tts/*, /v1/cite[/styles]
  cite.mjs             citeproc/CSL citation formatting
  csl/                 bundled CSL styles (IEEE, Nature, ACM, AMA, Harvard…)
  sidecar/             agent.mjs (Claude Agent SDK) + tts.mjs (Edge neural TTS)

browser-extension/     "Send to Marginalia" web capture
docs/                  design + migration plans
```

The two server containers sit behind private HTTPS (Tailscale serve); the apps
point at one host (data/PDF/sync on `:8443`, the AI relay on `:10000`).

## Build & run

### Native apps (Xcode 16+/Swift 5+; XcodeGen)

```bash
cd ios-native
xcodegen generate
# macOS:
xcodebuild -scheme MarginaliaMac -destination 'platform=macOS' build
# iOS simulator (no signing):
xcodebuild -scheme MarginaliaSpike -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Re-run `xcodegen generate` whenever you add a `.swift` file. The server URL +
token are embedded in `Settings` (overridable in the app's Settings screen).

### Data + sync server (Rust)

```bash
cd server-rs
MARG_TOKEN=your-shared-secret cargo run -p marginalia-server   # :8800
# or: docker build -f server-rs/Dockerfile -t marginalia-data . && docker run …
```

### AI relay (Node)

```bash
cd server
npm --prefix sidecar install --omit=dev
npm install --omit=dev
ANTHROPIC_API_KEY=sk-…  MARG_TOKEN=your-shared-secret  node server.mjs   # :8799
# or: docker build -f server/Dockerfile -t marginalia-ai . && docker run …
```

## Features

Library (filters, collections, tags, search) · reader with a streaming AI
**explainer** + native **PDFKit** (highlights, page resume, import) ·
**read-aloud** (Edge neural TTS) · add by DOI/arXiv/URL or web clip · **AI chat**
about a paper or the whole library · **semantic search** (Voyage embeddings) ·
**retraction checks** (Retraction Watch) · **citations** (full CSL: APA/MLA/
Chicago/IEEE/Nature/ACM/AMA/Harvard/BibTeX) · BibTeX/RIS export · dashboard ·
Discover (Hugging Face daily papers + arXiv search) · RSS/Atom feeds · notebook ·
flashcards + spaced-repetition review · connections graph · per-record sync.
