# Native iOS spike — proof-or-discard plan

**Goal:** in ~1 day, prove (or cheaply kill) the "native SwiftUI client + self-
hosted server" idea **before** committing to the multi-week build in
[`NATIVE-IOS-SERVER-PLAN.md`](./NATIVE-IOS-SERVER-PLAN.md).

**Throwaway by design.** All spike code lives in `ios-native/` (the SwiftUI app)
and a tiny `ios-native/stub-server.mjs`. If the spike fails a gate, delete that
dir — nothing else in the repo is touched. The real build reuses
`db.rs`/`metadata.rs`; the spike does not (it uses a stub server) so we move fast.

## What we're actually de-risking (in risk order)

1. **Toolchain.** Does a native iOS app even build on this machine's Xcode-27
   beta? (Hypothesis: yes — the `swift-rs` bug was Tauri-specific; a normal iOS
   app target compiles straight for iOS with no macOS-host build to contaminate.)
2. **Reader.** Is PDFKit a good native replacement for the pdf.js webview?
3. **Client↔server loop.** Can the app fetch the real library over HTTP (bearer
   token) and render it?
4. *(stretch)* **AI.** Does SSE streaming from the existing `server.mjs` work from
   native `URLSession`?

## Kill criteria — discard the spike if

- A trivial SwiftUI app won't compile/launch in the iOS Simulator on the
  available Xcode (Gate 0 fails) **and** installing a stable Xcode isn't an option.
- PDFKit can't render the library's PDFs acceptably (Gate 2).
- The client↔server loop needs something we can't reasonably build (Gate 3).

If all gates pass → green-light the full `NATIVE-IOS-SERVER-PLAN.md`.

## Gates (each is a build/run checkpoint)

| Gate | Proves | Build |
|---|---|---|
| **0. Hello-world** | toolchain: SwiftUI app compiles + launches in Simulator (no signing) | empty `@main` view |
| **1. Library list** | models + SwiftUI list render real papers | bundled seed papers → `List` |
| **2. PDFKit reader** | the reader thesis (native > webview) | tap → `PDFView` of `sample.pdf` |
| **3. Server fetch** | client↔server loop | stub Node server → `GET /v1/papers` w/ bearer token |
| **4. AI (stretch)** | SSE works natively | chat against existing `server.mjs` |

## Tooling (all present)

- **XcodeGen** generates `MarginaliaSpike.xcodeproj` from `ios-native/project.yml`
  (CLI; no Xcode GUI). Build with `xcodebuild -sdk iphonesimulator`.
- Simulators: iPhone 17 family available; simulator install needs **no signing**.
- Stub server: Node `http`, serves `seed.json` papers + `sample.pdf`, bearer auth.

## Decision

- **All gates green** → write the SwiftUI app for real per the full plan; promote
  `ios-native/` from spike to product; build the Axum server reusing the Rust core.
- **Any hard wall** → `rm -rf ios-native/`, document why, fall back to the PWA path
  (which reuses the existing React UI and also escapes the Tauri/Xcode blocker).
