# UX improvements — research-backed, implemented

Derived from a deep-research pass (Readwise Reader, Instapaper, Ink & Switch
local-first, Pocket's 2025 shutdown) fused with the codebase. All items below are
**implemented**; the research caveats and deferred work are at the end.

## Quick wins (shipped)

1. **In-app prompt/confirm modal** (`store.requestPrompt`/`requestConfirm`,
   `DialogModal`). `window.prompt`/`window.confirm` are **no-ops in the Tauri
   webview** — they silently broke New collection, rename, notes, feed
   rename/folder, and backup restore. All replaced with a real async dialog.
2. **Unified triage Inbox** — the cross-type "to-read" spine (papers + bookmarks
   + feed posts, not-done & not-archived), top of the sidebar, unread-first +
   newest sort. (Reframed the former "Reading Queue".)
3. **Auto-advance after Done** — finishing a bookmark advances the detail
   selection; the reader's **✓ Done · Next** archives and opens the next item for
   one-after-another reading (`store.markDoneAndNext`).
4. **Inline selection AI in the reader** — selecting text (in PDFs *and* Markdown
   articles) pops Highlight / Copy / **Explain** / **✨ Ask**, opening the chat with
   the passage pinned and a preset question prefilled (`openChatPreset`).
5. **Long-form typography panel** (`Aa`) — serif/sans, size, measure (width),
   line-height for the article reader; persisted. Instapaper-grade calm reading.
6. **Deeper Cmd-K palette** — an actions registry surfacing every navigation/
   command with its shortcut, alongside paper search; plus a **`?` shortcuts
   sheet** (`ShortcutsModal`).
7. **Pocket + OPML import** — import a Pocket `ril_export.html` as bookmarks
   (timely after Pocket's 2025 shutdown); OPML import already covered feeds.

## Larger bets (shipped)

- **A · Daily Review / resurfacing** (`Review.tsx`, `lib/review.ts`) — resurfaces
  highlights (SRS-due first via the existing scheduler, then density-weighted
  random), "Saved & forgotten" dormant items, and "On this day". Sidebar +
  palette entry.
- **B · Rich article highlighting** — select-to-highlight text in Markdown
  articles (captured to annotations) and **click a figure/image to save it** to
  highlights.
- **C · Text-to-speech listen mode** — Web Speech API (`▶`) reads the article
  aloud, chunked so engines don't truncate; on-device, no key.
- **E · Reflowable PDF mode** (`⊟`) — opt-in single-column reflow of a PDF's
  cached full text into the typography reader; **native PDF.js stays the default**
  for dense/academic layouts (reflow is weaker there per the research).
- **D · E2E-encrypted sync** (`lib/crypto.ts`) — optional passphrase encrypts the
  WebDAV snapshot on-device (AES-256-GCM + PBKDF2, Web Crypto) so the server only
  sees ciphertext; backward-compatible with unencrypted snapshots.

## What we deliberately did NOT build (refuted in verification)
Bionic reading / autopace / text-chunking; accessibility fonts as a headline
feature; and copying Raindrop's (unverified) nested-collections/auto-tag/RSS.

## Deferred / next steps
- **iOS companion app.** Groundwork done: `window-vibrancy` is now gated to
  `cfg(macos/windows)` so the Rust side can compile for `aarch64-apple-ios`.
  Remaining (a separate effort): `tauri ios init`; rewrite the AI sidecar to call
  the Anthropic API over HTTPS (iOS can't spawn the Node subprocess); an iOS Share
  Extension to replace the browser-extension capture; rework watch-folders/library
  to the app sandbox + document picker. E2E sync (above) is the sync substrate.
- In-reader **repaint** of Markdown highlights on reopen (currently captured to
  the annotations list, not repainted in the body).
- Auto-send for inline-AI presets (today they prefill the question; user presses
  Enter).
- Sidebar **folder grouping** for feeds (folders are stored + OPML round-tripped).
