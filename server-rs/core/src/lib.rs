//! Shared Marginalia logic — reused VERBATIM from the desktop app's Tauri-free
//! modules via `#[path]` includes. There is a single source of truth: editing
//! `src-tauri/src/db.rs` (etc.) updates both the desktop app and this server, so
//! the SQLite schema and query logic can never diverge.
//!
//! These three modules have no `tauri` imports (verified) and reference only
//! `rusqlite`, `serde_json`, and `reqwest`, which is why they drop straight in.

#[path = "../../../src-tauri/src/db.rs"]
pub mod db;

#[path = "../../../src-tauri/src/metadata.rs"]
pub mod metadata;

#[path = "../../../src-tauri/src/embeddings.rs"]
pub mod embeddings;
