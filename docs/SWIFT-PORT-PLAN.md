# Marginalia → native Swift port plan

Porting the React/TypeScript app to a **native SwiftUI iOS app** backed by a
**single-user self-hosted server** with an **on-device offline cache**.

## Status — MVP→full-parity build COMPLETE & verified (2026-06-25)

Native SwiftUI app built in `ios-native/` (26 Swift files, ~3k lines; XcodeGen →
`xcodebuild`, builds clean on Xcode-27 beta). Every phase below was run in the iOS
Simulator and screenshot-verified; network/streaming/crypto paths were exercised
against live services or mocks.

| Phase | Built | Verified |
|---|---|---|
| A Foundations (models, JSON repo, AppModel, NavigationSplitView shell) | ✅ | sidebar + counts from real seed |
| B Library (table/card, filters, search, collections CRUD, edit sheet) | ✅ | list + card screenshots |
| C Reader (**PDFKit**, highlight capture, saved-highlight redraw, progress, import) | ✅ | PDF renders, 1/19 progress |
| D Capture (arXiv Atom + Crossref DOI lookup, web clip, PDF import) | ✅ | **live** arXiv + DOI fetch |
| E AI (SSE `ChatService`, chat about paper / ask library, summarize) | ✅ | **live SSE stream** vs mock server |
| F Dashboard, Feeds (RSS/Atom), Flashcards+Review (SRS), Discover, Notebook | ✅ | **live** arXiv search + HN RSS |
| G Sync (encrypted WebDAV snapshot, AES-GCM+PBKDF2 = crypto.ts, union-merge) | ✅ | **encrypt→PUT→GET→decrypt** round-trip |
| H Citations (APA/MLA/Chicago/BibTeX), native force-directed graph, settings | ✅ | graph + cite + flashcards |

**Architecture as built:** offline-first local JSON store (mirrors `localRepo.ts`);
all network features run direct from the device (no CORS) — lookup/feeds/discover
port `metadata.rs`; AI streams from the self-hosted `server.mjs` over SSE; sync is
the desktop's encrypted-WebDAV mechanism (so it doubles as cross-device migration).

**Remaining (signing/Apple-account-gated — can't run headless here):**
- **Share Extension** target (App Group + entitlements) for "Share → Marginalia"
  from Safari, and the `marginalia://` deep-link capture handler.
- **Distribution**: device signing team, TestFlight/sideload.
- **Full CSL styles** (ieee/nature/…) via a server `/v1/cite` endpoint — native
  covers the 4 common styles.
- **Axum data server** reusing `db.rs` (the planned infra track) — optional; the
  app is fully functional offline + WebDAV-synced without it.

Dev/screenshot launch hooks (`MARG_*` env vars in `applyLaunchOverrides`) drive any
screen headlessly; they're inert in normal launches (strip before App Store).

---

## Original plan (for reference)

- **Gate 0 PASSED.** A native SwiftUI app compiles *and* runs in the iOS Simulator
  on this machine's Xcode-27 beta. The `swift-rs`/Tauri blocker does **not** apply
  to a normal iOS app target — going native escapes it.

## Why a port (not a rewrite) is tractable

The app already separates concerns the way a port needs:
- **Data layer is a 12-method `Repository` interface** → becomes a Swift protocol
  with a GRDB (local) + Remote (HTTP) implementation.
- **Server logic already exists** in `db.rs`/`metadata.rs`/`embeddings.rs`
  (no Tauri coupling) → wrap in Axum, reuse verbatim.
- **Data is plain JSON** (`types.ts`) → 1:1 Swift `Codable` structs.
- Much of `src/lib` is **pure logic** (dedupe, reading, review SRS, references,
  time, items) → mechanical Swift ports.

What genuinely gets rebuilt: the **views** (SwiftUI) and the **state hub**
(`store.ts` → `@Observable` models). The reader *upgrades* from pdf.js to PDFKit.

---

## Target stack

| Concern | Choice | Notes |
|---|---|---|
| UI | **SwiftUI**, min **iOS 17** | `@Observable` (Observation), modern APIs |
| State | `@Observable` classes | `AppModel` root + per-feature models ≈ `store.ts` slices |
| Local cache | **GRDB.swift** (SQLite) | mirrors `db.rs` schema: JSON blobs + FTS5 + kv + embeddings |
| Reader | **PDFKit** | native PDF + `PDFAnnotation` highlights ↔ `Highlight` model |
| Markdown | **MarkdownUI** (SPM) | GFM parity with react-markdown+remark-gfm (tables, etc.) |
| Networking | `URLSession` async/await | SSE via `URLSession.bytes` for AI streaming |
| Secrets | **Keychain** | server URL + bearer token |
| Citations | **server `/v1/cite`** | reuse `citeproc`/`csl.ts`; cache results on device |
| Crypto (sync) | **CryptoKit** | if the E2E-encrypted snapshot path is kept |
| Deps | SPM via XcodeGen `packages:` | GRDB, MarkdownUI |

---

## Project structure (`ios-native/`)

```
ios-native/
  project.yml                 # XcodeGen: app + ShareExtension targets, SPM deps
  Sources/
    App/                      # MarginaliaApp, AppModel, routing, TabView/SplitView shell
    Models/                   # Paper, Collection, Feed, Settings, Highlight, Retraction (Codable)
    Store/                    # GRDB schema + DAO  (≈ db.rs)
    Data/                     # Repository protocol; LocalRepository (GRDB); RemoteAPI (HTTP)
    Sync/                     # pull/push engine, offline mutation queue, LWW
    Services/                 # ChatService (SSE), CiteService, LookupService, EmbedService
    Features/
      Library/  Reader/  ItemDetail/  AddCapture/  Chat/
      Dashboard/  Feeds/  Flashcards/  Review/  Discover/  Settings/  Onboarding/
    Common/                   # helpers ported from src/lib (dedupe, reading, review, time…)
  ShareExtension/             # "Share → Marginalia" → capture
```

---

## Data model & state mapping

- **`src/types.ts` → `Models/`** (1:1 `Codable`): `Paper`, `Highlight`,
  `Retraction`, `Collection`, `Feed`, `Settings`, plus enums (`ReadingStatus`,
  `ItemKind`, `ArticleSource`). Optional fields → Swift optionals. Store the full
  `Paper` as JSON in GRDB (matching `db.rs`) so unknown/added fields round-trip.
- **`src/store.ts` (2456 lines) → `AppModel` + feature models.** The store is the
  biggest single artifact. Decompose by slice, each an `@Observable`:
  `LibraryModel`, `ReaderModel`, `ChatModel`, `FeedsModel`, `ReviewModel`,
  `SettingsModel`. Shared selection/filter state on `AppModel`. Most store actions
  are repo calls + local array transforms → direct translations.

---

## Component → Swift mapping

| React component | Lines | Swift | Strategy |
|---|---|---|---|
| `Reader.tsx` | 1173 | `Reader/ReaderView` + `ReaderModel` | **replace pdf.js → PDFKit** (centerpiece) |
| `Library.tsx` | 663 | `Library/LibraryView` + `LibraryModel` | port: `List`, filters, collections, search |
| `Settings.tsx` | 522 | `Settings/SettingsView` | port: `Form` |
| `Modals.tsx` | 437 | sheets/`confirmationDialog` | port |
| `GraphView.tsx` | 393 | `GraphView` | **defer** → later native Canvas or `WKWebView` |
| `Dashboard.tsx` | 266 | `Dashboard/DashboardView` | port |
| `ChatPanel.tsx` | 261 | `Chat/ChatView` + `ChatService` | port + SSE streaming |
| `Sidebar.tsx` | 236 | `NavigationSplitView` sidebar / drawer | port (native nav) |
| `Feeds.tsx` | 201 | `Feeds/FeedsView` | port |
| `CommandPalette.tsx` | 173 | native search / `.searchable` | **rethink** (defer) |
| `Discover.tsx` | 163 | `Discover/DiscoverView` | port |
| `Flashcards.tsx` | 139 | `Flashcards/FlashcardsView` | port |
| `Review.tsx` | 102 | `Review/ReviewView` | port |
| `Notebook.tsx` | 80 | `Notebook/NotebookView` | port + MarkdownUI |
| `Onboarding.tsx` | 30 | `Onboarding/OnboardingView` | repurpose: server URL + token setup |
| `Toast.tsx` | 26 | overlay/`.alert` | port |
| `TitleBar.tsx` | 78 | — | **drop** (native nav bar) |

## lib module → Swift mapping

| `src/lib` | Swift home | Strategy |
|---|---|---|
| `repo/localRepo/tauriRepo` | `Data/` protocol + GRDB + Remote | re-architect |
| `metadata.ts` | `LookupService` → `GET /v1/lookup` | server |
| `citation.ts`, `csl.ts` | `CiteService` → `POST /v1/cite` | server (reuse JS) |
| `pdf.ts` | PDFKit | replace |
| `markdown.ts` | MarkdownUI | replace |
| `search.ts` | GRDB FTS / `GET /v1/search` | port/server |
| `embeddings.ts` | `EmbedService` → `/v1/semantic`,`/v1/similar` | server |
| `agent.ts` | `ChatService` (SSE) | port transport |
| `feeds.ts` | `FeedsModel` + `GET /v1/feed` | server fetch + light port |
| `discover.ts` | `DiscoverService` (+server proxy) | port/server |
| `crypto.ts` | CryptoKit | port (if E2E kept) |
| `dedupe, items, library, reading, references, retraction, review, time` | `Common/` | **pure ports** |

---

## Server (see `NATIVE-IOS-SERVER-PLAN.md`)

One Axum binary reusing `db.rs`/`metadata.rs`/`embeddings.rs` + disk PDF store +
the existing `server.mjs` AI relay. Bearer-token auth (`MARG_TOKEN`), HTTPS via
Tunnel/Tailscale/Caddy. Endpoints map ~1:1 to today's Tauri commands. ≈1 week.

---

## Phased roadmap — each phase ends in a runnable app

| Phase | Deliverable | Gate | Est. |
|---|---|---|---|
| **A. Foundations** | project structure, Models, GRDB store, Repository, RemoteAPI, Keychain, Onboarding (server URL+token), app shell | app connects to server, persists locally | ~1 wk |
| **B. Library MVP** | list + filters + collections + FTS search + item detail; server CRUD live | browse the real library offline | ~1 wk |
| **C. Reader** | PDFKit view, highlights→`Highlight`, notes, status/progress, resume | read + annotate a paper | ~1.5 wk |
| **D. Add / Capture** | DOI/arXiv/URL lookup, add flow, **Share Extension** | save from Safari | ~3 d |
| **E. AI** | Chat panel, summarize, extract (SSE) | stream a chat | ~3 d |
| **F. Secondary** | Dashboard, Feeds, Flashcards, Review, Discover | feature parity (minus graph) | ~1.5 wk |
| **G. Sync & migrate** | offline queue, pull/push, LWW conflict; import existing library to server | edits converge across devices | ~1 wk |
| **H. Polish & ship** | citations, command-palette equiv, graph (defer/webview), a11y, TestFlight/sideload | shippable | ~1 wk |

**MVP (A–C): ~3–4 weeks. Full parity: ~7–10 weeks.**

---

## What changes vs the desktop app (intentionally dropped/replaced)

- **Dropped (desktop-only):** watch folders, localhost-capture listener, library-
  folder picker, window vibrancy/"glass", custom title bar. Capture on iOS = Share
  Extension + deep link.
- **Replaced:** pdf.js → PDFKit; react-markdown → MarkdownUI; localStorage/Tauri
  SQLite → GRDB + server; command palette → native search.
- **Server-side now:** metadata lookup, retraction, feed fetch, citations,
  embeddings, AI (all already network-bound).

## Risks & open decisions

- **CSL/citeproc** — no clean Swift port; keep on server (`/v1/cite`) + cache. ✅ decided.
- **Graph (d3-force)** — defer; later native Canvas sim or embed the React graph in
  a `WKWebView`. Not MVP.
- **Offline conflict** — LWW can clobber a concurrent desktop edit; acceptable for
  single-user read-mostly (already a documented limitation). Per-record `updatedTs`
  sync narrows the window.
- **PDF size/bandwidth** — lazy download + cache + metadata-only sync; never force a
  full pull on cellular.
- **Two UIs to maintain** — every feature now ships in React *and* Swift. The real
  ongoing cost of going native; budget for it.

## Data migration (one-time)

The phone gets data from the server. Seed the server by importing the existing
desktop library: export the current SQLite/localStorage snapshot and `PUT` it to
the server's `/v1/papers` (+ collections/feeds/settings, + upload PDFs). Reuse the
existing snapshot/`replacePapers` shape.

---

## Immediate next step

Begin **Phase A**: promote `ios-native/` — add Models (port `types.ts`), the GRDB
store, the Repository protocol + RemoteAPI skeleton, Keychain, and an Onboarding
screen that captures the server URL + token — then point it at the stub/real
server and render the library. The current `ContentView` becomes the app shell.
