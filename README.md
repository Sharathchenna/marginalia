# Marginalia

A local-first research paper manager — a calm, reading-first alternative to
Mendeley/Zotero. Built with **Tauri + React + TypeScript**.

It implements the UI from the Claude Design handoff ("Paper Manager") **and**
wires it to working local-first functionality: persistent storage, live
metadata lookup, a real PDF.js reader, ranked search, and citation
import/export. Runs fully in the browser for development; a native SQLite
backend (Rust) drops in behind the same interface for the desktop build.

## Run it

```bash
npm install
npm run dev        # → http://localhost:1420  (web preview, no Rust needed)
```

To run as a native desktop app (requires the Rust toolchain + Tauri prereqs:
https://tauri.app/start/prerequisites/):

```bash
npm run tauri dev
```

## What's implemented (from the design)

| Screen / feature | Status |
|---|---|
| Three-pane shell (collapsible sidebar, list, detail) | ✅ |
| Table + card views, sortable, multi-select bulk bar | ✅ |
| Inline star / read-status toggles | ✅ |
| Collections (nestable) + tags filtering | ✅ |
| Detail panel (abstract, metadata, tags, notes) | ✅ |
| PDF reader: thumbnails, highlight palette, annotations sidebar | ✅ |
| Notebook (highlights aggregated across papers) | ✅ |
| ⌘K command palette with full-text snippet highlighting | ✅ |
| Import + add-by-identifier + citation modals, toasts | ✅ |
| Settings (library location, watch folders, theme, cite style) | ✅ |
| Onboarding first-run screen | ✅ |
| Light / dark theme + compact / comfortable density | ✅ |

Keyboard: **⌘K** opens the palette, **Esc** closes overlays, **↑/↓** move the
library selection. **⌘/Ctrl-click** a row to multi-select for the bulk bar.

## What actually works (beyond the mockup)

All six phases of the build plan are implemented:

1. **Persistence** — everything (papers, collections, settings, highlights,
   read/star state) persists across reloads. Browser backend uses
   `localStorage`; native uses SQLite. Both sit behind one `Repository`
   interface (`src/lib/repo.ts`) so the UI is identical.
2. **Metadata lookup** — *Add by ID* really fetches from **arXiv** and
   **CrossRef** (DOI / arXiv ID / URL), de-dupes against your library, and adds
   the paper. (Dev uses Vite proxies to dodge CORS; native uses `reqwest`.)
3. **PDF.js reader** — renders the **actual paper PDF** (streamed from arXiv via
   proxy, with a bundled fallback): real pages, generated thumbnails, page
   navigation, a selectable text layer, and **select-to-highlight** that saves
   annotations.
4. **Search** — ⌘K is backed by a tokenized, field-weighted ranked search
   (`src/lib/search.ts`); native mirrors it with SQLite **FTS5**.
5. **Citations** — APA / MLA / Chicago / BibTeX formatting with working
   clipboard copy, plus **library export** (BibTeX / RIS) and **import** (paste
   or drop a `.bib`/`.ris` file) in Settings and the Import modal.
6. **Polish** — persisted theme/density/default-style/library-location/watch
   folders, empty states, and a `notify`-based watch-folder watcher on the
   native side.

Verify the logic yourself: `node scripts/smoke.mjs` (15 runtime assertions over
search, citation round-trips, and identifier parsing).

## Native desktop build (Rust)

The `src-tauri/` backend is complete (SQLite via `rusqlite` + FTS5, `reqwest`
metadata, `notify` watch folders, all commands registered). It needs the Rust
toolchain, which wasn't available in the environment this was built in, so the
**Rust side is written but not yet compiled here**. To run it:

```bash
# 1. install Rust + Tauri prerequisites: https://tauri.app/start/prerequisites/
# 2. generate app icons once (Tauri needs them to build):
npm run tauri icon path/to/icon.png
# 3. regenerate the native seed if you change src/data.ts:
node scripts/gen-seed.mjs
# 4. run:
npm run tauri dev
```

## Design tokens

Cobalt-iris accent · Inter (UI) · Source Serif 4 (reading) · JetBrains Mono
(code/identifiers). All tokens (light + dark) live in
[`src/styles/tokens.css`](src/styles/tokens.css), ported verbatim from the design.

## Architecture

```
src/
  store.ts            # all app state + actions (useStore hook); hydrates from repo
  data.ts             # seed papers, collections, highlight palette
  types.ts            # domain types
  icons.tsx           # SVG icon set
  lib/
    repo.ts           # Repository interface + backend selection
    localRepo.ts      # localStorage backend (browser / dev)
    tauriRepo.ts      # Tauri command backend (native)
    tauri.ts          # isTauri() + invoke() helper
    metadata.ts       # arXiv + CrossRef identifier lookup
    pdf.ts            # pdf.js setup, page/text-layer rendering
    search.ts         # ranked full-text search
    citation.ts       # APA/MLA/Chicago/BibTeX/RIS + import parser
  styles/             # tokens.css (design tokens) + app.css (components)
  components/         # TitleBar, Sidebar, Library, Reader, Notebook,
                      # Settings, Onboarding, CommandPalette, Modals, Toast
src-tauri/
  src/lib.rs          # Tauri commands + setup + watcher
  src/db.rs           # SQLite (JSON blobs + FTS5)
  src/metadata.rs     # reqwest arXiv/CrossRef lookup
  seed.json           # demo library (generated from data.ts)
scripts/
  gen-seed.mjs        # regenerate src-tauri/seed.json from data.ts
  smoke.mjs           # runtime tests for the logic modules
```

## Future ideas

- Swap the hand-rolled citation formatter for a full CSL/citeproc engine (more styles).
- Render saved highlights as overlays on the PDF (currently captured + listed).
- Real PDF text/metadata extraction on import (Rust) for files without an identifier.
- Optional cross-device sync layer on top of the local SQLite store.

## Provenance

UI recreated from a Claude Design handoff bundle. Original design medium was
HTML/CSS/JS prototypes; this is an idiomatic React port matching the visual
output (per the bundle's README guidance).
