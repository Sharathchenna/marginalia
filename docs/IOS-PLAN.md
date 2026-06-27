# Marginalia on iOS — build runbook

The codebase is now **iOS-ready**; the remaining steps need a Mac with **full
Xcode** + an **Apple Developer account** (they can't run in CI / Command-Line-
Tools-only environments). This doc is the runbook to take it the last mile.

## Session status (2026-06-25) — verified
**Done & verified in code:** phases 0–4 (cfg-gated Rust, responsive UI, AI-over-
HTTPS server, deep-link capture, E2E + auto-sync); desktop app still builds clean
(cargo check + smoke 35/35).
**Done in the iOS project:** `tauri ios init` generated `src-tauri/gen/apple/
marginalia.xcodeproj`; **deployment target bumped to 15.0** (`tauri.conf.json`
`bundle.iOS.minimumSystemVersion` + `gen/apple/project.yml`); **`marginalia://`
URL scheme added** to `gen/apple/marginalia_iOS/Info.plist` (so deep-link/Share-
Extension capture works); Rust iOS targets + CocoaPods 1.16.2 installed.

**BLOCKER (Phase 5 native compile):** building on **Xcode-beta 27** fails inside
Tauri's `swift-rs` step — `swift build` cross-compiles the Tauri Swift package and
passes the iOS target triple (`-Xcc --target=arm64-apple-ios…-simulator`) to the
**macOS-host** clang module builds, so macOS WebKit/AppKit/CoreImage get compiled
with iOS conditionals and fail on iOS-only headers:
`OpenGLES/EAGL.h`, `UIKit/NSAttributedString.h`, `CoreServices/CSIdentityBase.h`.
The macOS SDKs are NOT broken (they build those modules fine standalone) and the
app code is fine — it's a swift-rs 1.0.7 × Xcode-27 toolchain bug. Ruled out:
explicit-modules-off (fails differently), Tauri upgrade (already latest 2.11.3 /
swift-rs 1.0.7), guarding the dependency's Swift source (pervasive/fragile).
**Fix: build on a non-beta Xcode** (its Swift toolchain doesn't emit the
contaminated invocation). Device install also needs an Apple ID for signing.

### Exact finish (on stable Xcode)
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer   # NOT -beta
xcodebuild -version                                               # confirm stable
cd /Users/sharathchenna/Developer/personal-projects/marginalia
npm run tauri ios build -- --target aarch64-sim                   # verify compile (no signing)
npm run tauri ios dev --open                                      # Xcode → iPhone → Team=Apple ID → ▶ Run
```
If you re-run `tauri ios init`, re-add the `CFBundleURLTypes` (`marginalia`) block
to `gen/apple/marginalia_iOS/Info.plist`.

## What's already done in code (this session)
- **iOS-compilable Rust** — `window-vibrancy` and `notify` are target-gated; the
  localhost capture listener, watch-folder watcher, and `AppState.watcher` are
  `#[cfg(desktop)]`-gated, with mobile no-op fallbacks. `cargo check` (macOS)
  green. (`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`.)
- **Responsive shell** — `isMobilePlatform()` + a `narrow` viewport signal drive a
  single-column layout, an off-canvas sidebar drawer, and reader simplification
  (`src/lib/tauri.ts`, `store.ts`, `App.tsx`, `TitleBar.tsx`, `Library.tsx`, CSS).
  Test on desktop by narrowing the window < 760px.
- **AI over HTTPS** — `server/` (self-hostable; reuses `agent.mjs`) + a remote
  transport in `src/lib/agent.ts` (gated on **Settings → AI backend**). This is
  how iOS/web get AI (no local Node sidecar).
- **Capture via deep link** — `route_deep_link` in `lib.rs` routes
  `marginalia://add?u=` / `subscribe?u=` into the capture pipeline; the iOS Share
  Extension source is in `ios/share-extension/`.
- **E2E sync + auto-sync** — `src/lib/crypto.ts` encrypts the WebDAV snapshot;
  opt-in auto-sync pulls on launch (timestamp-guarded) and pushes on background.

## Prereqs (one-time)
```bash
xcode-select --install            # then install full Xcode from the App Store
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
sudo gem install cocoapods        # or: brew install cocoapods
```
Plus an **Apple Developer Program** membership ($99/yr) for device runs, the
Share Extension's App Group, and TestFlight/App Store. (A free personal team
allows 7-day sideloads while developing.)

## Phase 0 — scaffold + simulator
```bash
npm run tauri ios init            # generates src-tauri/gen/apple
npm run tauri ios dev             # build + run in the simulator
```
If `notify` or any desktop crate still pulls in on iOS, confirm it's excluded by
the `Cargo.toml` target tables. In the generated app `Info.plist`, ensure
`CFBundleURLTypes` registers the **`marginalia`** scheme (needed by the deep-link
capture + Share Extension).

## Phase 2 — AI backend
```bash
cd src-tauri/sidecar && npm install && cd -
ANTHROPIC_API_KEY=sk-ant-... MARG_TOKEN=secret node server/server.mjs   # or Docker (server/Dockerfile)
```
Put it behind HTTPS, then in the app: **Settings → AI backend** → URL + token.

## Phase 3 — Share Extension
Follow `ios/share-extension/README.md`: add a Share Extension target in Xcode,
drop in the provided `ShareViewController.swift` + `Info.plist`, sign with the
same team. "Share → Marginalia" then opens `marginalia://add?u=…`.

## Phase 4 — sync on device
Turn on **Settings → Auto-sync on this device** on the phone (pull on launch,
push on background; LWW). For true background refresh/poll add an iOS
`BGTaskScheduler` task via a small native plugin (follow-up).

## Phase 5 — distribution
In Xcode: set the bundle id, signing team, App Group entitlement (Share
Extension), and a privacy manifest. Then:
```bash
npm run tauri ios build           # archive → IPA
```
Upload via Xcode Organizer / Transporter → TestFlight → App Store review.

## Known limitations / follow-ups
- Sync is **last-writer-wins** (whole-snapshot). Fine for a read-mostly companion;
  concurrent edits across devices can overwrite. A per-record/CRDT sync is a
  separate track.
- Full-text article clipping on iOS passes the URL to the app (or the AI backend)
  for extraction; the in-WKWebView Readability path is the reference.
- Background feed polling needs `BGTaskScheduler` (native).
