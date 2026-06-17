# Plan — Liquid Glass UI (macOS-first, with fallback)

Goal: give Marginalia the **Liquid Glass** look on macOS, and degrade gracefully
to a solid/standard UI everywhere else (Windows, Linux, web preview).

## What's actually achievable (important framing)
Marginalia's UI is a **webview** (Tauri). Apple's true Liquid Glass material —
the real-time refraction/lensing/specular response — is a **SwiftUI/AppKit**
material; it is **not** exposed to web content, so we cannot render genuine
Liquid Glass *inside* the page for individual controls.

Two layers get us most of the way:

1. **Native window material (the real thing, for free).** Tauri can back the
   window with a native macOS `NSVisualEffect` material. On **macOS 26 (Tahoe)**
   the system renders those materials with the new **Liquid Glass** appearance
   automatically — no per-app API needed. On older macOS it's the classic frosted
   vibrancy (still good). This is the closest thing to "real" Liquid Glass we can
   ship from a webview app.
2. **CSS glass for the chrome (cross-platform approximation).** Toolbars, sidebars,
   the AI/annotations panel, modals, command palette, and popovers get a
   translucent, blurred, specular treatment via `backdrop-filter`. This is the
   fallback that also works on Windows/Linux/web.

Content surfaces that hold text or the PDF stay **opaque** (readability beats
prettiness over the reading column and PDF page).

---

## Phase 1 — Native window vibrancy (macOS)
- Window config: `transparent: true` (macOS only) and apply a window effect.
  - Tauri v2 `windowEffects` (in `tauri.conf.json` `app.windows[]`) or the
    `window-vibrancy` crate at runtime in `lib.rs`.
  - Material: `underWindowBackground` or `sidebar` for the shell;
    `hudWindow`/`popover` for floating surfaces.
- Make the app root background **translucent** so the native material shows
  through: introduce a `--bg-window` value that is semi-transparent when glass
  is active, opaque otherwise.
- Keep the traffic-light/titlebar handling we already have.

## Phase 2 — CSS glass tokens + chrome treatment (cross-platform)
- Add a `glass` token group in `tokens.css`:
  - translucent panel fills (e.g. `color-mix(in srgb, var(--bg-panel) 62%, transparent)`)
  - `backdrop-filter: blur(22px) saturate(180%)` (+ `-webkit-` prefix)
  - hairline border + a soft top **specular highlight** (inset box-shadow)
- Apply to chrome only: `.thumbs`, `.reader-toolbar`, `.chat-sidebar`,
  `.ann-sidebar`, `.sidebar`, `.modal`, `.scrim`, `.sel-pop`, command palette,
  toasts.
- Leave `.reading-scroll`, `.pdf-page`, `.md-page`, and detail/text areas solid.

## Phase 3 — Platform detection + fallback
- Detect platform once at startup (Tauri `@tauri-apps/plugin-os` `platform()`):
  - **macOS** → `data-glass="full"` (native material + CSS glass).
  - **Windows** → `data-glass="acrylic"` (Tauri Mica/Acrylic window effect + CSS
    glass-lite).
  - **Linux / web** → `data-glass="off"` (solid current design; no
    `backdrop-filter`).
- Set the attribute on `.app-shell`; all glass CSS is gated on it, so non-glass
  platforms keep today's look with zero risk.
- **Settings toggle**: "Translucent interface (Liquid Glass)" — default on for
  macOS, off elsewhere. Lets users disable for perf/readability.
- **Accessibility**: honor `@media (prefers-reduced-transparency: reduce)` and
  `prefers-contrast` → force `data-glass`-equivalent solid styles.

## Phase 4 — Readability & performance guardrails
- Cap simultaneous blurred layers (each `backdrop-filter` is GPU work); the
  reading area is the perf-sensitive surface, and it stays opaque.
- Ensure text contrast over glass (AA): bump text tokens / add a subtle scrim
  layer under text-heavy panels when glass is on.
- Verify dark + light themes, and the three PDF reading themes, all read well
  with glass chrome.

---

## Phases summary
1. **Native macOS window material** — biggest visual win, real Liquid Glass on
   Tahoe; small change in `tauri.conf.json` / `lib.rs` + root bg.
2. **CSS glass chrome** — cross-platform approximation for panels/overlays.
3. **Platform detect + fallback + settings toggle + a11y** — safe degradation.
4. **Readability/perf pass** — keep content opaque, contrast AA, limit blur.

**Recommended start:** Phase 1 + 2 behind `data-glass`, macOS-only by default, so
nothing changes for other platforms until we opt them in.
