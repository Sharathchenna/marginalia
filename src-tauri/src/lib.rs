// Marginalia native backend (Tauri v2). Persists the library to a local SQLite
// database and exposes the same operations the localStorage backend provides in
// the browser, so the React frontend is identical on both.
mod agent;
mod capture;
mod db;
mod embeddings;
mod metadata;

use std::sync::Mutex;

#[cfg(desktop)]
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    db: Mutex<Connection>,
    // Watch-folder watcher is desktop-only (notify has no mobile backend).
    #[cfg(desktop)]
    watcher: Mutex<Option<RecommendedWatcher>>,
    // live AI sidecar processes by requestId, so ai_cancel can kill them
    children: Mutex<std::collections::HashMap<String, u32>>,
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
        "autoBib": false,
        "webdavUrl": "",
        "webdavUser": "",
        "webdavPass": ""
    })
}

// ---------- commands ----------

#[tauri::command]
fn list_papers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::list_papers(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_papers(papers: Vec<Value>, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::replace_papers(&mut conn, &papers).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_paper(paper: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::upsert_paper(&conn, &paper).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_paper(id: String, patch: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::update_paper(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_paper(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::delete_paper(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_papers(query: String, state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::search(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_collections(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    Ok(db::get_kv(&conn, "collections")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
fn save_collections(collections: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::set_kv(&conn, "collections", &collections).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_feeds(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    Ok(db::get_kv(&conn, "feeds")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
fn save_feeds(feeds: Value, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    db::set_kv(&conn, "feeds", &feeds).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
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
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
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

/// Check one DOI against Crossref's Retraction Watch data. Privacy-preserving:
/// only the DOI is sent. Returns `{ retracted, type?, reason?, date?, url? }`.
#[tauri::command]
fn check_retraction(doi: String) -> Result<Value, String> {
    metadata::check_retraction(&doi)
}

/// The localhost port the web-capture listener bound to (0 if it failed to bind).
#[tauri::command]
fn capture_port() -> u16 {
    capture::port()
}

/// Save an arbitrary web page as a library item (title + description from the page).
#[tauri::command]
fn fetch_webpage(url: String) -> Result<Value, String> {
    metadata::fetch_webpage(&url)
}

/// Fetch an RSS/Atom feed (or a page to sniff for one) with a conditional GET.
#[tauri::command]
fn fetch_feed(url: String, etag: String, since: String) -> Result<Value, String> {
    metadata::fetch_feed(&url, &etag, &since)
}

// ---------- optional sync (user-hosted WebDAV) ----------
// A privacy-respecting cross-device option: the user points at their own WebDAV
// server (Nextcloud, Fastmail, a self-hosted box…). We PUT/GET a single snapshot
// file; no Marginalia-operated server is involved.

fn webdav_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn webdav_upload(url: String, user: String, pass: String, contents: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("WebDAV URL must start with http:// or https://".into());
    }
    let mut req = webdav_client()?.put(&url).body(contents);
    if !user.is_empty() {
        req = req.basic_auth(user, Some(pass));
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("WebDAV upload failed ({})", resp.status()))
    }
}

/// Download the snapshot. A 404 (nothing uploaded yet) returns an empty string
/// rather than an error, so first-time "pull" is a no-op the UI can handle.
#[tauri::command]
fn webdav_download(url: String, user: String, pass: String) -> Result<String, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("WebDAV URL must start with http:// or https://".into());
    }
    let mut req = webdav_client()?.get(&url);
    if !user.is_empty() {
        req = req.basic_auth(user, Some(pass));
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(String::new());
    }
    if !resp.status().is_success() {
        return Err(format!("WebDAV download failed ({})", resp.status()));
    }
    resp.text().map_err(|e| e.to_string())
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
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    let (key, model) = embed_settings(&conn);
    let count = db::embedding_count(&conn, &model).map_err(|e| e.to_string())?;
    Ok(json!({ "embedded": count, "model": model, "hasKey": key.is_some() }))
}

/// Embed papers that changed (or were never embedded) and store their vectors.
/// `items` is `[{ id, text }]`; unchanged papers (same model+hash) are skipped.
#[tauri::command]
fn embed_papers(items: Vec<Value>, state: State<AppState>) -> Result<Value, String> {
    // 1. read settings + decide what needs (re)embedding — under the DB lock.
    let (key, model, to_embed, skipped) = {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
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
        (key, model, to_embed, skipped)
    };

    // 2. call Voyage WITHOUT holding the lock, so other DB commands aren't frozen
    //    for the whole network round-trip.
    let mut rows: Vec<(String, usize, String, Vec<u8>)> = Vec::new();
    for chunk in to_embed.chunks(100) {
        let texts: Vec<String> = chunk.iter().map(|(_, t, _)| t.clone()).collect();
        let vecs = embeddings::embed(&key, &model, &texts, "document")?;
        for ((id, _t, hash), vec) in chunk.iter().zip(vecs.iter()) {
            if vec.is_empty() {
                continue;
            }
            rows.push((id.clone(), vec.len(), hash.clone(), embeddings::f32_to_bytes(vec)));
        }
    }

    // 3. persist the new vectors — re-acquire the lock briefly.
    let embedded = {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
        let mut n = 0usize;
        for (id, dim, hash, bytes) in &rows {
            db::upsert_embedding(&conn, id, &model, *dim, hash, bytes).map_err(|e| e.to_string())?;
            n += 1;
        }
        n
    };
    Ok(json!({ "embedded": embedded, "skipped": skipped, "total": items.len() }))
}

/// Embed `query` and return the top-k papers by cosine similarity.
#[tauri::command]
fn semantic_search(query: String, k: usize, state: State<AppState>) -> Result<Vec<Value>, String> {
    let (key, model) = {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
        embed_settings(&conn)
    };
    let key = key.ok_or("No Voyage API key set.")?;
    // embed the query lock-free (network), then re-lock only to read vectors
    let qvec = embeddings::embed(&key, &model, &[query], "query")?
        .into_iter()
        .next()
        .unwrap_or_default();
    if qvec.is_empty() {
        return Ok(vec![]);
    }
    let all = {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
        db::all_embeddings(&conn, &model).map_err(|e| e.to_string())?
    };
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
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
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

// Flatten a caller-supplied name to a single safe path component (no separators,
// no "..", no leading dots) so it can never escape the library folder.
fn safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') { '_' } else { c })
        .collect();
    let trimmed = cleaned.replace("..", "_");
    let trimmed = trimmed.trim_start_matches(['.', ' ']).trim();
    if trimmed.is_empty() {
        "file.pdf".to_string()
    } else {
        trimmed.to_string()
    }
}

// A destination that doesn't clobber an existing file: name.pdf, name-1.pdf, …
fn unique_dest(dir: &str, filename: &str) -> (std::path::PathBuf, String) {
    // Expand the directory once — `join` shell-expands every call, so doing it in
    // the collision loop would repeat the HOME lookup on each iteration.
    let expanded_dir = std::path::PathBuf::from(shellexpand(dir));
    let dest = expanded_dir.join(filename);
    if !dest.exists() {
        return (dest, filename.to_string());
    }
    let path = std::path::Path::new(filename);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("pdf");
    let mut i = 1;
    loop {
        let cand = format!("{stem}-{i}.{ext}");
        let dest = expanded_dir.join(&cand);
        if !dest.exists() {
            return (dest, cand);
        }
        i += 1;
    }
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
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Refused to download a non-http(s) URL".into());
    }
    let name = safe_filename(&filename);
    let dest = join(&dir, &name);
    if !dest.exists() {
        std::fs::create_dir_all(shellexpand(&dir)).map_err(|e| e.to_string())?;
        let bytes = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?
            .get(&url)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .map_err(|e| e.to_string())?;
        std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(name)
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
    let raw = src_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Invalid file name")?;
    let name = safe_filename(&raw);
    std::fs::create_dir_all(shellexpand(&dir)).map_err(|e| e.to_string())?;
    // never overwrite a different PDF that happens to share a filename
    let (dest, used) = unique_dest(&dir, &name);
    std::fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
    Ok(used)
}

/// Watch the given folders; emit `watch-import` with the path of each new PDF.
/// Desktop-only — a no-op on mobile (no user-accessible filesystem to watch).
#[cfg(mobile)]
#[tauri::command]
fn start_watch(app: AppHandle, folders: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let _ = (&app, &folders, &state);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn start_watch(app: AppHandle, folders: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // Create OR a rename-into-place (how browsers finish .crdownload/.part
            // downloads). Case-insensitive extension; skip empty/partial files.
            let is_new = matches!(
                ev.kind,
                EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
            );
            if is_new {
                for path in ev.paths {
                    let is_pdf = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("pdf"))
                        .unwrap_or(false);
                    let ready = std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false);
                    if is_pdf && ready {
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
    *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = Some(watcher);
    Ok(())
}

/// If the window's center lies outside every connected monitor (e.g. it was
/// restored onto an external display that's no longer plugged in), resize it to
/// fit and recenter it on the primary monitor.
fn ensure_on_screen(win: &tauri::WebviewWindow) {
    use tauri::{LogicalSize, PhysicalPosition};
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let cx = pos.x + size.width as i32 / 2;
    let cy = pos.y + size.height as i32 / 2;
    let monitors = win.available_monitors().unwrap_or_default();
    let visible = monitors.iter().any(|m| {
        let (mp, ms) = (m.position(), m.size());
        cx >= mp.x && cx < mp.x + ms.width as i32 && cy >= mp.y && cy < mp.y + ms.height as i32
    });
    if visible {
        return;
    }
    if let Ok(Some(primary)) = win.primary_monitor() {
        let (mp, ms, sf) = (primary.position(), primary.size(), primary.scale_factor());
        let lw = ((ms.width as f64 / sf) - 160.0).clamp(900.0, 1280.0);
        let lh = ((ms.height as f64 / sf) - 140.0).clamp(600.0, 820.0);
        let _ = win.set_size(LogicalSize::new(lw, lh));
        let _ = win.set_position(PhysicalPosition::new(mp.x + 80, mp.y + 70));
    }
}

// Route a marginalia:// deep link to the capture pipeline.
//   marginalia://add?u=<url-encoded>        → emit "capture-url"  (resolve to an item)
//   marginalia://subscribe?u=<url-encoded>  → emit "capture-feed" (subscribe to a feed)
//   marginalia://open                       → just focus the window
fn route_deep_link(app: &AppHandle, raw: &str) {
    let Some(rest) = raw.strip_prefix("marginalia://") else {
        return;
    };
    let (action, query) = match rest.split_once('?') {
        Some((a, q)) => (a.trim_end_matches('/'), q),
        None => (rest.trim_end_matches('/'), ""),
    };
    let mut target = String::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "u" || k == "url" {
                target = deeplink_decode(v);
            }
        }
    }
    match action {
        "add" if !target.is_empty() => {
            let _ = app.emit("capture-url", target);
        }
        "subscribe" if !target.is_empty() => {
            let _ = app.emit("capture-feed", target);
        }
        _ => {}
    }
}

// Minimal percent-decoder for the deep-link `u` param (std-only).
fn deeplink_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
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
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("marginalia.db"))?;
            seed_if_empty(&conn)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                #[cfg(desktop)]
                watcher: Mutex::new(None),
                children: Mutex::new(std::collections::HashMap::new()),
            });

            // One-click web capture: a localhost listener a bookmarklet/extension
            // POSTs the current page URL to. Desktop-only — iOS has no browser
            // extensions and sandboxes localhost; mobile capture uses the
            // marginalia:// deep link / Share Extension instead.
            #[cfg(desktop)]
            capture::start(app.handle().clone());

            // marginalia:// deep link — lets the browser extension launch/focus the
            // app when it isn't running (Obsidian-style). Opening any marginalia://
            // URL brings the window to the front; the extension then retries capture.
            // marginalia:// deep links — focus the window (desktop) AND route any
            // capture payload to the frontend. On iOS this is the primary capture
            // path: the Share Extension opens marginalia://add?u=<url> (or
            // /subscribe?u=) and the existing capture pipeline handles it.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    #[cfg(desktop)]
                    if let Some(win) = handle.get_webview_window("main") {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    for url in event.urls() {
                        route_deep_link(&handle, url.as_str());
                    }
                });
                // Linux/Windows need runtime registration; macOS/iOS use the bundled
                // Info.plist scheme. Either failure is non-fatal.
                #[cfg(desktop)]
                let _ = app.deep_link().register_all();
            }

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

            // Recover a window that the OS restored onto a now-disconnected
            // monitor: if its center isn't inside any connected display, recenter
            // it on the primary one. Without this, unplugging an external screen
            // can leave Marginalia stranded off-screen with no way to grab it.
            // macOS restores the saved NSWindow frame *after* this setup hook, so
            // we also re-check shortly after launch on the main thread.
            if let Some(win) = app.get_webview_window("main") {
                ensure_on_screen(&win);
                let w = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let wc = w.clone();
                    let _ = w.run_on_main_thread(move || ensure_on_screen(&wc));
                });
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
            list_feeds,
            save_feeds,
            get_settings,
            save_settings,
            lookup_identifier,
            check_retraction,
            capture_port,
            fetch_webpage,
            fetch_feed,
            webdav_upload,
            webdav_download,
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
            agent::ai_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marginalia");
}
