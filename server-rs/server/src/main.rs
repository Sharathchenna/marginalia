//! Marginalia self-hosted data + sync server (Axum).
//!
//! Re-targets the desktop app's Tauri commands to HTTP routes, reusing the exact
//! same `db` / `metadata` / `embeddings` logic via the `marginalia-core` crate.
//! This is the sync hub + PDF object store for the native iOS app (and any future
//! `RemoteRepository` web build). See docs/NATIVE-IOS-SERVER-PLAN.md.
//!
//! Env:
//!   PORT             listen port (default 8800 — the Node AI relay uses 8799)
//!   MARG_TOKEN       require `Authorization: Bearer <token>` on /v1/* (set this!)
//!   MARG_DB          SQLite path (default ./data/library.db)
//!   MARG_PDF_DIR     PDF object-store dir (default ./data/pdfs)
//!   MARG_CORS_ORIGIN allowed CORS origin (default "*")
//!   AGENT_SCRIPT     path to sidecar/agent.mjs to enable POST /v1/agent (optional)
use std::convert::Infallible;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use async_stream::stream;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use marginalia_core::{db, embeddings, metadata};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;

struct AppState {
    db: Mutex<Connection>,
    token: String,
    pdf_dir: PathBuf,
    agent_script: Option<PathBuf>,
}

// ---------- error + blocking helpers ----------

struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}
fn err500(e: impl ToString) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
type ApiResult<T> = Result<T, ApiError>;

/// Run a synchronous DB closure on the blocking pool (rusqlite + reqwest::blocking
/// must not run on the async runtime), locking the shared connection inside. The
/// closure gets `&mut Connection` (we hold the mutex exclusively) so write paths
/// like `db::replace_papers` that need a transaction work; read-only `&Connection`
/// calls auto-reborrow.
async fn db_blocking<T, F>(state: Arc<AppState>, f: F) -> ApiResult<T>
where
    F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        f(&mut conn)
    })
    .await
    .map_err(err500)?
    .map_err(err500)
}

fn embed_settings(conn: &Connection) -> (Option<String>, String) {
    let s = db::get_kv(conn, "settings").ok().flatten().unwrap_or_else(|| json!({}));
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

// ---------- papers + sync ----------

/// Server-authoritative wall clock (ms). Stamped on every write so sync deltas
/// never depend on (skewed) device clocks.
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A record's change time: updatedTs, falling back to addedTs.
fn record_ts(p: &Value) -> i64 {
    p.get("updatedTs").or_else(|| p.get("addedTs")).and_then(Value::as_i64).unwrap_or(0)
}

fn is_deleted(p: &Value) -> bool {
    p.get("deleted").and_then(Value::as_bool).unwrap_or(false)
}

#[derive(Deserialize)]
struct SinceQ {
    since: Option<i64>,
}

async fn list_papers(State(st): State<Arc<AppState>>, Query(q): Query<SinceQ>) -> ApiResult<Json<Value>> {
    let papers = db_blocking(st, |c| db::list_papers(c).map_err(|e| e.to_string())).await?;
    let out: Vec<Value> = match q.since {
        // Sync pull: everything changed since `since`, INCLUDING tombstones.
        Some(since) => papers.into_iter().filter(|p| record_ts(p) >= since).collect(),
        // Normal list: live papers only (hide tombstones).
        None => papers.into_iter().filter(|p| !is_deleted(p)).collect(),
    };
    Ok(Json(json!(out)))
}

async fn get_paper(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let p = db_blocking(st, move |c| db::get_paper(c, &id).map_err(|e| e.to_string())).await?;
    match p {
        Some(v) => Ok(Json(v)),
        None => Err(ApiError(StatusCode::NOT_FOUND, "paper not found".into())),
    }
}

async fn add_paper(State(st): State<Arc<AppState>>, Json(mut paper): Json<Value>) -> ApiResult<Json<Value>> {
    let ts = now_ms();
    if let Some(o) = paper.as_object_mut() {
        o.insert("updatedTs".into(), json!(ts));
        o.entry("addedTs").or_insert(json!(ts));
    }
    db_blocking(st, move |c| db::upsert_paper(c, &paper).map_err(|e| e.to_string())).await?;
    Ok(Json(json!({ "ok": true, "updatedTs": ts })))
}

async fn update_paper(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(mut patch): Json<Value>,
) -> ApiResult<Json<Value>> {
    let ts = now_ms();
    if let Some(o) = patch.as_object_mut() {
        o.insert("updatedTs".into(), json!(ts));
    }
    db_blocking(st, move |c| db::update_paper(c, &id, &patch).map_err(|e| e.to_string())).await?;
    Ok(Json(json!({ "ok": true, "updatedTs": ts })))
}

async fn delete_paper(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    // Soft delete → a tombstone that syncs to other devices.
    let ts = now_ms();
    db_blocking(st, move |c| db::soft_delete_paper(c, &id, ts).map_err(|e| e.to_string())).await?;
    Ok(Json(json!({ "ok": true, "updatedTs": ts })))
}

async fn replace_papers(State(st): State<Arc<AppState>>, Json(papers): Json<Vec<Value>>) -> ApiResult<Json<Value>> {
    db_blocking(st, move |c| db::replace_papers(c, &papers).map_err(|e| e.to_string())).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct SearchQ {
    q: String,
}
async fn search(State(st): State<Arc<AppState>>, Query(sq): Query<SearchQ>) -> ApiResult<Json<Value>> {
    let r = db_blocking(st, move |c| db::search(c, &sq.q).map_err(|e| e.to_string())).await?;
    Ok(Json(json!(r)))
}

// ---------- KV-backed: collections / settings / feeds ----------

async fn get_kv_or(st: Arc<AppState>, key: &'static str, default: Value) -> ApiResult<Json<Value>> {
    let v = db_blocking(st, move |c| db::get_kv(c, key).map_err(|e| e.to_string())).await?;
    Ok(Json(v.unwrap_or(default)))
}
async fn put_kv(st: Arc<AppState>, key: &'static str, value: Value) -> ApiResult<Json<Value>> {
    let ts = now_ms();
    db_blocking(st, move |c| {
        db::set_kv(c, key, &value).map_err(|e| e.to_string())?;
        db::set_kv(c, &format!("{key}_ts"), &json!(ts)).map_err(|e| e.to_string())
    })
    .await?;
    Ok(Json(json!({ "ok": true, "updatedTs": ts })))
}

async fn get_collections(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    get_kv_or(st, "collections", json!([])).await
}
async fn put_collections(State(st): State<Arc<AppState>>, Json(v): Json<Value>) -> ApiResult<Json<Value>> {
    put_kv(st, "collections", v).await
}
async fn get_feeds(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    get_kv_or(st, "feeds", json!([])).await
}
async fn put_feeds(State(st): State<Arc<AppState>>, Json(v): Json<Value>) -> ApiResult<Json<Value>> {
    put_kv(st, "feeds", v).await
}

async fn get_settings(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    get_kv_or(st, "settings", json!({})).await
}
async fn put_settings(State(st): State<Arc<AppState>>, Json(patch): Json<Value>) -> ApiResult<Json<Value>> {
    // Merge patch into existing settings (matches the desktop save_settings).
    let ts = now_ms();
    db_blocking(st, move |c| {
        let mut merged = db::get_kv(c, "settings").map_err(|e| e.to_string())?.unwrap_or_else(|| json!({}));
        if let (Some(obj), Some(p)) = (merged.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                obj.insert(k.clone(), v.clone());
            }
        }
        db::set_kv(c, "settings", &merged).map_err(|e| e.to_string())?;
        db::set_kv(c, "settings_ts", &json!(ts)).map_err(|e| e.to_string())
    })
    .await?;
    Ok(Json(json!({ "ok": true, "updatedTs": ts })))
}

/// One-shot pull for both apps: everything changed since `since` (papers incl.
/// tombstones, plus the collections/feeds/settings blobs with their timestamps),
/// and the server clock to anchor the next `since`. Clients LWW per record/blob.
async fn sync(State(st): State<Arc<AppState>>, Query(q): Query<SinceQ>) -> ApiResult<Json<Value>> {
    let server_ts = now_ms();
    let since = q.since.unwrap_or(0);
    let v = db_blocking(st, move |c| {
        let papers: Vec<Value> = db::list_papers(c)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|p| record_ts(p) >= since)
            .collect();
        let kv = |k: &str| db::get_kv(c, k).ok().flatten();
        Ok(json!({
            "serverTs": server_ts,
            "papers": papers,
            "collections": kv("collections"), "collectionsTs": kv("collections_ts"),
            "feeds": kv("feeds"), "feedsTs": kv("feeds_ts"),
            "settings": kv("settings"), "settingsTs": kv("settings_ts"),
        }))
    })
    .await?;
    Ok(Json(v))
}

// ---------- "Latest" feed (Hugging Face daily papers) ----------

#[derive(Deserialize)]
struct FeedQ {
    limit: Option<usize>,
    q: Option<String>,
}

/// Normalize an arXiv id for matching: drop any URL prefix and a trailing version
/// (e.g. "https://arxiv.org/abs/2606.26080v2" -> "2606.26080").
fn norm_arxiv(id: &str) -> String {
    let s = id.rsplit('/').next().unwrap_or(id).to_lowercase();
    if let Some(pos) = s.rfind('v') {
        if pos > 0 && s[pos + 1..].chars().all(|c| c.is_ascii_digit()) && !s[pos + 1..].is_empty() {
            return s[..pos].to_string();
        }
    }
    s
}

/// Latest trending ML/LLM papers from Hugging Face daily papers, deduped, ranked
/// by upvotes, with an `inLibrary` flag for papers already saved. The feed both
/// apps render for the "latest LLM research" use case.
async fn feed_latest(State(st): State<Arc<AppState>>, Query(fq): Query<FeedQ>) -> ApiResult<Json<Value>> {
    let limit = fq.limit.unwrap_or(40).min(100);
    // Force IPv4 — this box has no IPv6 route and HF resolves dual-stack.
    let client = reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Marginalia/0.1")
        .build()
        .map_err(err500)?;

    let hf: Value = client
        .get("https://huggingface.co/api/daily_papers")
        .query(&[("limit", limit.to_string())])
        .send()
        .await
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("HF fetch failed: {e}")))?
        .json()
        .await
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("HF parse failed: {e}")))?;

    // Library arXiv ids (live papers only) so the app can flag already-saved ones.
    let lib: std::collections::HashSet<String> = db_blocking(st, |c| {
        Ok(db::list_papers(c)
            .map_err(|e| e.to_string())?
            .iter()
            .filter(|p| !p.get("deleted").and_then(Value::as_bool).unwrap_or(false))
            .filter_map(|p| p.get("arxiv").and_then(Value::as_str))
            .map(norm_arxiv)
            .collect())
    })
    .await?;

    let needle = fq.q.as_deref().map(str::to_lowercase);
    let mut items: Vec<Value> = Vec::new();
    if let Some(arr) = hf.as_array() {
        for it in arr {
            let paper = it.get("paper").unwrap_or(it);
            let arxiv = paper.get("id").and_then(Value::as_str).unwrap_or("").trim().to_string();
            if arxiv.is_empty() {
                continue;
            }
            let title = paper.get("title").and_then(Value::as_str).unwrap_or("").trim().to_string();
            let summary = paper.get("summary").and_then(Value::as_str).unwrap_or("").trim().to_string();
            if let Some(n) = &needle {
                if !title.to_lowercase().contains(n.as_str()) && !summary.to_lowercase().contains(n.as_str()) {
                    continue;
                }
            }
            let upvotes = paper.get("upvotes").and_then(Value::as_i64).unwrap_or(0);
            let authors = paper
                .get("authors")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.get("name").and_then(Value::as_str))
                        .take(8)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let published = it.get("publishedAt").and_then(Value::as_str).unwrap_or("").to_string();
            items.push(json!({
                "arxiv": arxiv,
                "title": title,
                "summary": summary,
                "authors": authors,
                "upvotes": upvotes,
                "publishedAt": published,
                "url": format!("https://arxiv.org/abs/{arxiv}"),
                "pdfUrl": format!("https://arxiv.org/pdf/{arxiv}"),
                "source": "huggingface",
                "inLibrary": lib.contains(&norm_arxiv(&arxiv)),
            }));
        }
    }
    // Rank by upvotes (HF daily ordering is already roughly trending).
    items.sort_by(|a, b| {
        let u = |v: &Value| v.get("upvotes").and_then(Value::as_i64).unwrap_or(0);
        u(b).cmp(&u(a))
    });
    items.truncate(limit);
    Ok(Json(json!({ "items": items, "source": "huggingface" })))
}

// ---------- metadata: lookup / retraction / webpage / feed ----------

#[derive(Deserialize)]
struct LookupQ {
    id: String,
}
async fn lookup(Query(q): Query<LookupQ>) -> ApiResult<Json<Value>> {
    let v = tokio::task::spawn_blocking(move || metadata::lookup(&q.id))
        .await
        .map_err(err500)?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct DoiQ {
    doi: String,
}
/// Check one DOI against Crossref's Retraction Watch data (privacy-preserving:
/// only the DOI is sent). Mirrors the desktop `check_retraction` command.
async fn retraction(Query(q): Query<DoiQ>) -> ApiResult<Json<Value>> {
    let v = tokio::task::spawn_blocking(move || metadata::check_retraction(&q.doi))
        .await
        .map_err(err500)?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct UrlQ {
    url: String,
}
/// Resolve an arbitrary web page into a saveable library item (title + summary).
/// Mirrors the desktop `fetch_webpage` command.
async fn webpage(Query(q): Query<UrlQ>) -> ApiResult<Json<Value>> {
    let v = tokio::task::spawn_blocking(move || metadata::fetch_webpage(&q.url))
        .await
        .map_err(err500)?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct FeedFetchQ {
    url: String,
    #[serde(default)]
    etag: String,
    #[serde(default)]
    since: String,
}
/// Fetch a user-subscribed RSS/Atom feed (or sniff a page for one) with a
/// conditional GET. Mirrors the desktop `fetch_feed` command. NOTE: distinct from
/// `/feed/latest`, which is the curated Hugging Face daily-papers feed.
async fn feed_fetch(Query(q): Query<FeedFetchQ>) -> ApiResult<Json<Value>> {
    let v = tokio::task::spawn_blocking(move || metadata::fetch_feed(&q.url, &q.etag, &q.since))
        .await
        .map_err(err500)?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(v))
}

// ---------- embeddings / semantic search ----------

async fn embed_status(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let v = db_blocking(st, |c| {
        let (key, model) = embed_settings(c);
        let count = db::embedding_count(c, &model).map_err(|e| e.to_string())?;
        Ok(json!({ "embedded": count, "model": model, "hasKey": key.is_some() }))
    })
    .await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct EmbedBody {
    items: Vec<Value>,
}
async fn embed(State(st): State<Arc<AppState>>, Json(body): Json<EmbedBody>) -> ApiResult<Json<Value>> {
    let items = body.items;
    let v = db_blocking(st, move |c| {
        let (key, model) = embed_settings(c);
        let key = key.ok_or("No Voyage API key set in settings.")?;
        let mut to_embed: Vec<(String, String, String)> = Vec::new();
        let mut skipped = 0usize;
        for it in &items {
            let id = it.get("id").and_then(Value::as_str).unwrap_or("");
            let text = it.get("text").and_then(Value::as_str).unwrap_or("");
            if id.is_empty() || text.trim().is_empty() {
                continue;
            }
            let hash = embeddings::text_hash(text);
            match db::embedding_meta(c, id).map_err(|e| e.to_string())? {
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
                db::upsert_embedding(c, id, &model, vec.len(), hash, &embeddings::f32_to_bytes(vec))
                    .map_err(|e| e.to_string())?;
                embedded += 1;
            }
        }
        Ok(json!({ "embedded": embedded, "skipped": skipped, "total": items.len() }))
    })
    .await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct SemanticQ {
    q: String,
    k: Option<usize>,
}
async fn semantic(State(st): State<Arc<AppState>>, Query(sq): Query<SemanticQ>) -> ApiResult<Json<Value>> {
    let k = sq.k.unwrap_or(20);
    let v = db_blocking(st, move |c| {
        let (key, model) = embed_settings(c);
        let key = key.ok_or("No Voyage API key set in settings.")?;
        let qvec = embeddings::embed(&key, &model, &[sq.q], "query")?
            .into_iter()
            .next()
            .unwrap_or_default();
        if qvec.is_empty() {
            return Ok(json!([]));
        }
        let all = db::all_embeddings(c, &model).map_err(|e| e.to_string())?;
        let mut scored: Vec<(String, f32)> = all
            .into_iter()
            .map(|(id, b)| (id, embeddings::cosine(&qvec, &embeddings::bytes_to_f32(&b))))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(json!(scored
            .into_iter()
            .take(k)
            .map(|(id, score)| json!({ "id": id, "score": score }))
            .collect::<Vec<_>>()))
    })
    .await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct KQ {
    k: Option<usize>,
}
async fn similar(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(kq): Query<KQ>,
) -> ApiResult<Json<Value>> {
    let k = kq.k.unwrap_or(8);
    let v = db_blocking(st, move |c| {
        let (_key, model) = embed_settings(c);
        let target = match db::get_embedding_vec(c, &id, &model).map_err(|e| e.to_string())? {
            Some(b) => embeddings::bytes_to_f32(&b),
            None => return Ok(json!([])),
        };
        let all = db::all_embeddings(c, &model).map_err(|e| e.to_string())?;
        let mut scored: Vec<(String, f32)> = all
            .into_iter()
            .filter(|(pid, _)| pid != &id)
            .map(|(pid, b)| (pid, embeddings::cosine(&target, &embeddings::bytes_to_f32(&b))))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(json!(scored
            .into_iter()
            .take(k)
            .map(|(pid, score)| json!({ "id": pid, "score": score }))
            .collect::<Vec<_>>()))
    })
    .await?;
    Ok(Json(v))
}

// ---------- PDF object store ----------

/// Only allow simple, traversal-free names; stored as `<id>.pdf`.
fn safe_pdf_name(id: &str) -> Option<String> {
    let id = id.strip_suffix(".pdf").unwrap_or(id);
    if id.is_empty()
        || id.contains("..")
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return None;
    }
    Some(format!("{id}.pdf"))
}

async fn put_pdf(State(st): State<Arc<AppState>>, Path(id): Path<String>, body: Bytes) -> ApiResult<Json<Value>> {
    let name = safe_pdf_name(&id).ok_or(ApiError(StatusCode::BAD_REQUEST, "bad id".into()))?;
    tokio::fs::create_dir_all(&st.pdf_dir).await.map_err(err500)?;
    let path = st.pdf_dir.join(name);
    let len = body.len();
    tokio::fs::write(&path, &body).await.map_err(err500)?;
    Ok(Json(json!({ "ok": true, "bytes": len })))
}

async fn get_pdf(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let Some(name) = safe_pdf_name(&id) else {
        return (StatusCode::BAD_REQUEST, "bad id").into_response();
    };
    match tokio::fs::read(st.pdf_dir.join(name)).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "application/pdf")], bytes).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "pdf not found").into_response(),
    }
}

#[derive(Deserialize)]
struct PdfFetchBody {
    url: String,
}
/// Server-side fetch: download a PDF from a URL straight into the object store as
/// `<id>.pdf`, so a client (e.g. the iOS app) can import an arXiv/journal PDF
/// without first downloading the bytes to the device. Mirrors desktop `download_pdf`.
async fn fetch_pdf(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<PdfFetchBody>,
) -> ApiResult<Json<Value>> {
    let name = safe_pdf_name(&id).ok_or(ApiError(StatusCode::BAD_REQUEST, "bad id".into()))?;
    let url = body.url;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "url must be http(s)".into()));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("Marginalia/0.1")
        .build()
        .map_err(err500)?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("fetch failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError(StatusCode::BAD_GATEWAY, format!("download failed ({})", resp.status())));
    }
    let bytes = resp.bytes().await.map_err(err500)?;
    let len = bytes.len();
    tokio::fs::create_dir_all(&st.pdf_dir).await.map_err(err500)?;
    tokio::fs::write(st.pdf_dir.join(name), &bytes).await.map_err(err500)?;
    Ok(Json(json!({ "ok": true, "bytes": len, "id": id })))
}

async fn list_pdf(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let mut ids = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(&st.pdf_dir).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            if let Some(n) = entry.file_name().to_str() {
                if let Some(stem) = n.strip_suffix(".pdf") {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    Ok(Json(json!(ids)))
}

// ---------- AI relay (SSE) — ports server.mjs ----------

async fn agent(State(st): State<Arc<AppState>>, body: Bytes) -> Response {
    let Some(script) = st.agent_script.clone() else {
        return (StatusCode::NOT_IMPLEMENTED, "AI relay disabled (set AGENT_SCRIPT)").into_response();
    };
    let dir = script.parent().map(PathBuf::from).unwrap_or_default();
    let mut child = match TokioCommand::new("node")
        .arg(&script)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("spawn node failed: {e}")).into_response(),
    };
    // Send the payload, then close stdin (EOF) so the sidecar starts its turn.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(&body).await;
    }
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "no sidecar stdout").into_response(),
    };
    let mut lines = BufReader::new(stdout).lines();
    let s = stream! {
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() { continue; }
            if let Ok(mut v) = serde_json::from_str::<Value>(&line) {
                if v.get("__marg").and_then(Value::as_bool).unwrap_or(false) {
                    if let Some(obj) = v.as_object_mut() { obj.remove("__marg"); }
                    yield Ok::<Event, Infallible>(Event::default().data(v.to_string()));
                }
            }
        }
        let _ = child.wait().await;
    };
    Sse::new(s).keep_alive(KeepAlive::default()).into_response()
}

// ---------- auth + wiring ----------

async fn auth(State(st): State<Arc<AppState>>, req: Request, next: Next) -> Result<Response, StatusCode> {
    if st.token.is_empty() {
        return Ok(next.run(req).await); // open (dev) — warned at startup
    }
    let ok = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .map(|h| h == format!("Bearer {}", st.token))
        .unwrap_or(false);
    if ok {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string())
}

#[tokio::main]
async fn main() {
    let port: u16 = env_or("PORT", "8800").parse().unwrap_or(8800);
    let token = std::env::var("MARG_TOKEN").unwrap_or_default();
    let cors_origin = env_or("MARG_CORS_ORIGIN", "*");
    let db_path = PathBuf::from(env_or("MARG_DB", "./data/library.db"));
    let pdf_dir = PathBuf::from(env_or("MARG_PDF_DIR", "./data/pdfs"));
    let agent_script = std::env::var("AGENT_SCRIPT").ok().map(PathBuf::from).filter(|p| p.exists());

    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::create_dir_all(&pdf_dir);
    let conn = db::open(&db_path).expect("failed to open SQLite db");

    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        token: token.clone(),
        pdf_dir,
        agent_script: agent_script.clone(),
    });

    let cors = if cors_origin == "*" {
        tower_http::cors::CorsLayer::permissive()
    } else {
        use axum::http::HeaderValue;
        tower_http::cors::CorsLayer::new()
            .allow_origin(cors_origin.parse::<HeaderValue>().expect("bad MARG_CORS_ORIGIN"))
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
    };

    let api = Router::new()
        .route("/papers", get(list_papers).post(add_paper))
        .route("/papers/replace", post(replace_papers))
        .route("/papers/:id", get(get_paper).put(update_paper).delete(delete_paper))
        .route("/sync", get(sync))
        .route("/feed/latest", get(feed_latest))
        .route("/search", get(search))
        .route("/collections", get(get_collections).put(put_collections))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/feeds", get(get_feeds).put(put_feeds))
        .route("/lookup", get(lookup))
        .route("/retraction", get(retraction))
        .route("/webpage", get(webpage))
        .route("/feed", get(feed_fetch))
        .route("/embed", post(embed))
        .route("/embed/status", get(embed_status))
        .route("/semantic", get(semantic))
        .route("/similar/:id", get(similar))
        .route("/pdf", get(list_pdf))
        .route("/pdf/:id", put(put_pdf).get(get_pdf))
        .route("/pdf/:id/fetch", post(fetch_pdf))
        .route("/agent", post(agent))
        .layer(middleware::from_fn_with_state(state.clone(), auth));

    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "ok": true })) }))
        .nest("/v1", api)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024)) // 64 MB PDFs
        .layer(cors)
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind failed");
    println!("Marginalia data server listening on :{port}");
    println!("  db: {}", db_path.display());
    println!("  auth: {}", if token.is_empty() { "OPEN (set MARG_TOKEN!)" } else { "Bearer token required" });
    println!("  AI relay: {}", if agent_script.is_some() { "on (/v1/agent)" } else { "off (AGENT_SCRIPT unset)" });
    axum::serve(listener, app).await.expect("server error");
}
