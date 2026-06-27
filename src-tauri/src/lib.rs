// Marginalia native backend (Tauri v2). Persists the library to a local SQLite
// database and exposes the same operations the localStorage backend provides in
// the browser, so the React frontend is identical on both.
mod agent;
mod db;
mod embeddings;
mod metadata;
mod tts;

use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    db: Mutex<Connection>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

const SEED: &str = include_str!("../seed.json");

fn default_settings() -> Value {
    json!({
        "theme": "light",
        "density": "compact",
        "view": "table",
        "defaultCite": "APA",
        "libraryLocation": "~/Documents/Marginalia",
        "watchFolders": ["~/Downloads/Papers", "~/Dropbox/Zotero-inbox"],
        "librarySet": false,
        "glass": true,
        "model": "",
        "embedProvider": "off",
        "embedModel": "voyage-3.5-lite",
        "voyageKey": "",
        "ttsProvider": "edge",
        "ttsVoice": "en-US-AriaNeural",
        "ttsRate": 1.0
    })
}

// ---------- commands ----------

#[tauri::command]
fn list_papers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_papers(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_papers(papers: Vec<Value>, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_papers(&conn, &papers).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_paper(paper: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_paper(&conn, &paper).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_paper(id: String, patch: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_paper(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_paper(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_paper(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_papers(query: String, state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::search(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_collections(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_kv(&conn, "collections")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
fn save_collections(collections: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_kv(&conn, "collections", &collections).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut settings = default_settings();
    if let Some(saved) = db::get_kv(&conn, "settings").map_err(|e| e.to_string())? {
        if let (Some(obj), Some(s)) = (settings.as_object_mut(), saved.as_object()) {
            for (k, v) in s {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    Ok(settings)
}

#[tauri::command]
fn save_settings(patch: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut merged = default_settings();
    if let Some(saved) = db::get_kv(&conn, "settings").map_err(|e| e.to_string())? {
        if let (Some(obj), Some(s)) = (merged.as_object_mut(), saved.as_object()) {
            for (k, v) in s {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    if let (Some(obj), Some(p)) = (merged.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    db::set_kv(&conn, "settings", &merged).map_err(|e| e.to_string())
}

#[tauri::command]
fn lookup_identifier(identifier: String) -> Result<Value, String> {
    metadata::lookup(&identifier)
}

/// Open an external URL in the system browser (PDF hyperlinks). Only http(s)/mailto.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err("Refused to open non-web URL".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    cmd.arg(&url);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------- semantic search (Voyage embeddings) ----------

/// Read the embedding key + model from saved settings.
fn embed_settings(conn: &Connection) -> (Option<String>, String) {
    let s = db::get_kv(conn, "settings")
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let key = s
        .get("voyageKey")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|k| !k.is_empty());
    let model = s
        .get("embedModel")
        .and_then(Value::as_str)
        .filter(|m| !m.is_empty())
        .unwrap_or("voyage-3.5-lite")
        .to_string();
    (key, model)
}

#[tauri::command]
fn embedding_status(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (key, model) = embed_settings(&conn);
    let count = db::embedding_count(&conn, &model).map_err(|e| e.to_string())?;
    Ok(json!({ "embedded": count, "model": model, "hasKey": key.is_some() }))
}

/// Embed papers that changed (or were never embedded) and store their vectors.
/// `items` is `[{ id, text }]`; unchanged papers (same model+hash) are skipped.
#[tauri::command]
fn embed_papers(items: Vec<Value>, state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (key, model) = embed_settings(&conn);
    let key = key.ok_or("No Voyage API key set. Add it in Settings → Semantic search.")?;

    let mut to_embed: Vec<(String, String, String)> = Vec::new(); // (id, text, hash)
    let mut skipped = 0usize;
    for it in &items {
        let id = it.get("id").and_then(Value::as_str).unwrap_or("");
        let text = it.get("text").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() || text.trim().is_empty() {
            continue;
        }
        let hash = embeddings::text_hash(text);
        match db::embedding_meta(&conn, id).map_err(|e| e.to_string())? {
            Some((m, h)) if m == model && h == hash => skipped += 1,
            _ => to_embed.push((id.to_string(), text.to_string(), hash)),
        }
    }

    let mut embedded = 0usize;
    for chunk in to_embed.chunks(100) {
        let texts: Vec<String> = chunk.iter().map(|(_, t, _)| t.clone()).collect();
        let vecs = embeddings::embed(&key, &model, &texts, "document")?;
        for ((id, _t, hash), vec) in chunk.iter().zip(vecs.iter()) {
            if vec.is_empty() {
                continue;
            }
            db::upsert_embedding(&conn, id, &model, vec.len(), hash, &embeddings::f32_to_bytes(vec))
                .map_err(|e| e.to_string())?;
            embedded += 1;
        }
    }
    Ok(json!({ "embedded": embedded, "skipped": skipped, "total": items.len() }))
}

/// Embed `query` and return the top-k papers by cosine similarity.
#[tauri::command]
fn semantic_search(query: String, k: usize, state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (key, model) = embed_settings(&conn);
    let key = key.ok_or("No Voyage API key set.")?;
    let qvec = embeddings::embed(&key, &model, &[query], "query")?
        .into_iter()
        .next()
        .unwrap_or_default();
    if qvec.is_empty() {
        return Ok(vec![]);
    }
    let all = db::all_embeddings(&conn, &model).map_err(|e| e.to_string())?;
    let mut scored: Vec<(String, f32)> = all
        .into_iter()
        .map(|(id, bytes)| (id, embeddings::cosine(&qvec, &embeddings::bytes_to_f32(&bytes))))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored
        .into_iter()
        .take(k)
        .map(|(id, score)| json!({ "id": id, "score": score }))
        .collect())
}

/// Nearest neighbours of one paper (uses stored vectors — no key/network needed).
#[tauri::command]
fn similar_papers(id: String, k: usize, state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (_key, model) = embed_settings(&conn);
    let target = match db::get_embedding_vec(&conn, &id, &model).map_err(|e| e.to_string())? {
        Some(b) => embeddings::bytes_to_f32(&b),
        None => return Ok(vec![]),
    };
    let all = db::all_embeddings(&conn, &model).map_err(|e| e.to_string())?;
    let mut scored: Vec<(String, f32)> = all
        .into_iter()
        .filter(|(pid, _)| pid != &id)
        .map(|(pid, bytes)| (pid, embeddings::cosine(&target, &embeddings::bytes_to_f32(&bytes))))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored
        .into_iter()
        .take(k)
        .map(|(pid, score)| json!({ "id": pid, "score": score }))
        .collect())
}

// ---------- library folder + PDF files ----------
use base64::Engine;

fn join(dir: &str, file: &str) -> std::path::PathBuf {
    std::path::Path::new(&shellexpand(dir)).join(file)
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(shellexpand(&path)).map_err(|e| e.to_string())
}

/// Write a UTF-8 text file (used for Markdown / Obsidian export). Creates parent dirs.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(shellexpand(&path));
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, contents).map_err(|e| e.to_string())
}

/// Read a local PDF and return it base64-encoded (pdf.js loads it as bytes).
#[tauri::command]
fn read_pdf(path: String) -> Result<String, String> {
    let bytes = std::fs::read(shellexpand(&path)).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Download a PDF into the library folder (skips if already present).
#[tauri::command]
fn download_pdf(url: String, dir: String, filename: String) -> Result<String, String> {
    let dest = join(&dir, &filename);
    if !dest.exists() {
        std::fs::create_dir_all(shellexpand(&dir)).map_err(|e| e.to_string())?;
        let bytes = reqwest::blocking::get(&url)
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .map_err(|e| e.to_string())?;
        std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(filename)
}

/// Recursively list every PDF under the library folder (incl. subfolders).
/// Returns `{ rel, name }` where `rel` is the path relative to the folder root.
#[tauri::command]
fn scan_pdfs(dir: String) -> Result<Vec<Value>, String> {
    let root = std::path::PathBuf::from(shellexpand(&dir));
    let mut out = Vec::new();
    walk_pdfs(&root, &root, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn walk_pdfs(
    root: &std::path::Path,
    cur: &std::path::Path,
    out: &mut Vec<Value>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(cur)? {
        let path = entry?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') {
            continue; // skip dotfiles / hidden dirs
        }
        if path.is_dir() {
            walk_pdfs(root, &path, out)?;
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
        {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(json!({ "rel": rel, "name": stem }));
        }
    }
    Ok(())
}

/// Copy an external PDF into the library folder; returns the stored filename.
#[tauri::command]
fn import_pdf(src: String, dir: String) -> Result<String, String> {
    let src_path = std::path::PathBuf::from(shellexpand(&src));
    let name = src_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Invalid file name")?;
    std::fs::create_dir_all(shellexpand(&dir)).map_err(|e| e.to_string())?;
    std::fs::copy(&src_path, join(&dir, &name)).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Watch the given folders; emit `watch-import` with the path of each new PDF.
#[tauri::command]
fn start_watch(app: AppHandle, folders: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Create(_)) {
                for path in ev.paths {
                    if path.extension().and_then(|e| e.to_str()) == Some("pdf") {
                        let _ = handle.emit("watch-import", path.to_string_lossy().to_string());
                    }
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for f in folders {
        let expanded = shellexpand(&f);
        let _ = watcher.watch(std::path::Path::new(&expanded), RecursiveMode::NonRecursive);
    }
    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

fn shellexpand(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}/{}", home.to_string_lossy(), rest);
        }
    }
    p.to_string()
}

fn seed_if_empty(conn: &Connection) -> rusqlite::Result<()> {
    let seed: Value = serde_json::from_str(SEED).unwrap_or(json!({}));
    if db::get_kv(conn, "collections")?.is_none() {
        if let Some(c) = seed.get("collections") {
            db::set_kv(conn, "collections", c)?;
        }
    }
    if db::get_kv(conn, "settings")?.is_none() {
        db::set_kv(conn, "settings", &default_settings())?;
    }
    if db::list_papers(conn)?.is_empty() {
        if let Some(papers) = seed.get("papers").and_then(Value::as_array) {
            for p in papers {
                db::upsert_paper(conn, p)?;
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("marginalia.db"))?;
            seed_if_empty(&conn)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                watcher: Mutex::new(None),
            });

            // Native window translucency. On macOS 26 (Tahoe) the system renders
            // this NSVisualEffect material as Liquid Glass automatically; on older
            // macOS it's classic frosted vibrancy. The frontend keeps the window
            // backdrop visible only when its `data-glass` mode is active, so this
            // is harmless when the user turns translucency off.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(win) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &win,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = apply_acrylic(&win, Some((18, 18, 20, 125)));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_papers,
            replace_papers,
            add_paper,
            update_paper,
            delete_paper,
            search_papers,
            list_collections,
            save_collections,
            get_settings,
            save_settings,
            lookup_identifier,
            open_url,
            start_watch,
            ensure_dir,
            write_text_file,
            read_pdf,
            download_pdf,
            import_pdf,
            scan_pdfs,
            embedding_status,
            embed_papers,
            semantic_search,
            similar_papers,
            agent::ai_chat,
            tts::tts_speak,
            tts::tts_voices
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marginalia");
}
