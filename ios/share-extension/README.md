# Marginalia iOS Share Extension

"Share → Marginalia" from Safari (or any app) to save a page/feed into the app.
These are **ready-to-add native files** — they're wired in Xcode *after*
`npm run tauri ios init` generates `src-tauri/gen/apple`.

How it works: the extension reads the shared URL and opens
`marginalia://add?u=<url>`. The host app already routes that deep link into its
capture pipeline (`route_deep_link` in `src-tauri/src/lib.rs` → `capture-url`
event → `store.captureUrl`). Use `marginalia://subscribe?u=<feed>` for a feed.

## Add it in Xcode (one-time)
1. Run `npm run tauri ios init` (needs full Xcode + CocoaPods), then
   `npm run tauri ios dev` to confirm the base app launches.
2. Open `src-tauri/gen/apple/marginalia.xcodeproj` in Xcode.
3. **File → New → Target… → Share Extension**. Name it e.g. `ShareExt`.
4. Replace the generated `ShareViewController.swift` and `Info.plist` with the
   two files in this folder.
5. Confirm the **host app** declares the `marginalia` URL scheme — Tauri already
   sets it via `tauri.conf.json` (`plugins.deep-link.desktop.schemes`); for iOS,
   verify `CFBundleURLTypes` in the generated app `Info.plist` includes
   `marginalia` (add it if `tauri ios init` didn't).
6. Set the extension's deployment target ≥ the app's; sign with the same team.
7. Build & run; share a webpage from Safari → "Save to Marginalia".

## Notes
- No App Group is needed for this URL-passing flow. If you later want the
  extension to enqueue saves while the app is closed (instead of foregrounding
  it), add an App Group and write to a shared file the app drains on launch.
- Full-text article clipping on iOS: the extension passes the URL; the app fetches
  + extracts readable text (or routes it through your AI backend). The browser
  extension's Readability flow is the reference.
