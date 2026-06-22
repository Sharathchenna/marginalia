# Marginalia Connector (Firefox)

A browser extension that captures papers from the web into your local Marginalia
library — the full version of the built-in bookmarklet.

## What it does

- **Save this page** — one click sends the current tab to Marginalia, which
  resolves the metadata (arXiv / DOI / Hugging Face) and fetches the PDF.
- **Find papers on this page** — scans the page for every arXiv, DOI, and `.pdf`
  link (plus the page's own `citation_*` meta tags) and lets you bulk-capture the
  ones you want.
- **Right-click → Save to Marginalia** — on any link or page.
- **Download PDFs** — for arXiv / direct-PDF links, save the files straight to
  your browser's downloads folder (DOIs need the app to resolve the publisher).

## How it connects

It talks to the desktop app over `http://127.0.0.1` (ports 8787–8790), the same
localhost listener the bookmarklet uses (`src-tauri/src/capture.rs`). No data
ever leaves your machine; the Marginalia app must be open for "Send to Marginalia"
to work (the status dot in the popup shows the connection).

## Install (temporary, for development)

1. Open the Marginalia desktop app (so the listener is running).
2. In Firefox, go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select
   `browser-extension/manifest.json`.
4. Pin the toolbar button and click it on any paper page.

> Temporary add-ons are removed when Firefox restarts. To install permanently,
> the extension needs to be packaged and signed via
> [addons.mozilla.org](https://addons.mozilla.org) (`web-ext build` + `web-ext sign`).

## Files

| File | Role |
|------|------|
| `manifest.json` | MV2 manifest (Firefox) |
| `marg.js` | shared helpers: port discovery, send, PDF-URL resolution |
| `background.js` | context menus + popup message bridge |
| `popup.html` / `popup.js` | toolbar UI |
| `scan.js` | injected page scanner for arXiv / DOI / PDF links |
| `icon.svg` | toolbar icon |
