//! Shared Marginalia logic — the SQLite store, metadata fetchers (DOI/arXiv
//! lookup, retraction, webpage/feed), and Voyage embeddings. These modules have
//! no `tauri` imports and reference only `rusqlite`, `serde_json`, and `reqwest`.
//!
//! They used to live in the desktop app's `src-tauri/src/` and were `#[path]`-
//! included here; since the Tauri app was retired in favour of the native Swift
//! apps, they now live here directly and `server-rs` is fully self-contained.

pub mod db;
pub mod metadata;
pub mod embeddings;
