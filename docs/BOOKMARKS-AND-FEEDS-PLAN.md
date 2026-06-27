# Bookmark manager + blog reader (RSS)

Extends Marginalia from a research-paper manager into one that *also* manages web
bookmarks and reads blogs — without forking the data model, search, collections,
graph, or sync. Web content becomes a first-class `kind: "article"` alongside the
original `"paper"`.

## Decisions (locked)

- **Unified model, not a separate entity.** A library item is a `Paper` with a
  `kind` discriminator (`"paper" | "article"`). Articles reuse every Paper field
  and all existing machinery (repo, FTS, tags, collections, highlights, notes,
  graph, embeddings, WebDAV/JSON sync). `kind` only changes presentation.
- **Bookmarks = full-content snapshots.** Saving a non-academic page clips its
  readable content (Readability + Turndown) and stores it offline; the reader
  renders it. No lightweight link-only bookmarks.
- **Blog reader = read-later + RSS.** Subscribe to blogs by site or feed URL;
  posts arrive as `article` items (`source: "feed"`). Read-later state reuses
  `read`/`status`, plus an `archived` flag for the Pocket-style archive.
- **RSS is native-first.** Arbitrary feed hosts are cross-origin, so fetching
  goes through the native `fetch_feed` (reqwest, conditional GET). The browser
  dev preview only reaches CORS-enabled feeds and degrades gracefully — same
  posture as web-capture and watch-folders.

## Data model (`src/types.ts`)

`Paper` gains: `kind`, `source` (`"clip" | "feed"`), `url`, `favicon`, `feedId`,
`publishedTs`, `readingTime`, `archived`. New `Feed` interface (id/url/siteUrl/
title/favicon/folder/lastFetched/lastError/etag/lastModified).

Filters: `bookmarks`, `feeds`, `feed:<id>`, `articles`, `archived`. Screen:
`feeds`.

## Storage (zero schema change)

- Native records are JSON blobs in the `papers` table → **articles need no DB
  change**. Feeds live in the generic `kv` table (key `"feeds"`), exactly like
  collections — `list_feeds`/`save_feeds` in `lib.rs`.
- Repository interface gains `listFeeds`/`saveFeeds`; localStorage backend uses
  `marginalia.feeds`.
- A one-time `migrateKinds` pass on load backfills `kind` (and url/readingTime
  for articles) for legacy records. `itemKind()` infers it on the fly regardless,
  so nothing depends on the backfill having run.

## Ingestion

- **Extension** (`browser-extension/`): the popup's primary action is
  context-aware — academic pages (detected via `scan.js` citation meta / arXiv /
  DOI) resolve to a paper + PDF; everything else is clipped as a full-text
  article. Explicit "Clip article" and "Subscribe to this blog's feed" actions;
  matching right-click context menus. `margSubscribe` → `GET /subscribe`.
- **Native listener** (`capture.rs`): existing `/add` + `/clip`, plus
  `/subscribe` → emits `capture-feed` (same `X-Marginalia`/`Sec-Fetch` CSRF
  guard).
- **Store**: `captureClip` stamps `kind/source/url/favicon/readingTime`.
  `subscribeFeed` resolves a site-or-feed URL, stores the feed, imports posts.
  A 15-min interval + on-launch poll refresh all feeds (`refreshAllFeeds`).

## RSS engine (`src/lib/feeds.ts`)

Pure parser for RSS 2.0 / RDF / Atom via `DOMParser`; `discoverFeedUrl` (find
`<link rel=alternate>`); `entryToArticle`; OPML import/export. `fetchFeed` wraps
the native conditional-GET command. Feed bodies are stored as HTML and rendered
through the reader's existing sanitized `rehype-raw`/`rehype-sanitize` pipeline —
no Turndown dependency in the app.

## UI

- **Sidebar**: a "Read" group — Bookmarks, Blog Feeds (→ feeds inbox), Archive
  (conditional), and the per-feed list with unread badges + favicons; a `+` to
  subscribe.
- **Library**: article-flavored rows (favicon + host + reading time/date) when
  the view is article/feed; context-aware empty states; detail panel gains
  "Read article", "Open original ↗", "Archive".
- **Reader**: article masthead (favicon, host, date, reading time, original URL)
  and a meta cluster that replaces the PDF pager/zoom for articles.
- **Feeds inbox** (`Feeds.tsx`): subscription cards (refresh/rename/folder/
  unsubscribe) + a river of unread posts + mark-all-read.
- **Dashboard**: "Latest from your feeds", "Unread bookmarks", Bookmarks/Feed
  stat cards. **Settings**: feed management + OPML import/export.
- **Keyboard**: `j`/`k` move the list selection, `Enter`/`o` open the reader.

## Deferred (honest blockers)

- **In-app full-text extraction for summary-only feeds.** The Rust side has no
  Readability/DOM, so it can't turn an arbitrary article URL into clean readable
  text server-side (same class of blocker as the deferred OCR work). Full-content
  feeds render completely; summary-only posts show the summary + "Open original
  ↗", and the browser extension can always re-clip a page to full text.
- **Sidebar folder grouping.** Folders are stored, edited, and round-tripped
  through OPML, but the sidebar lists feeds flat for now.
- **In-reader highlighting on articles.** Highlights render on the PDF text
  layer; the Markdown article view doesn't paint them yet.
